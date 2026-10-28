# Evidencia · Middleware de autenticación y autorización de Inventario

Corrida completa de los casos de [`docs/16-validacion-jwt.md`](../16-validacion-jwt.md) §16.2 contra el
cluster de Inventario. Las pruebas E, F, G, H e I toman sus líneas de acá.

Corrida del 28/10/2026 contra el cluster de Inventario en Docker Compose: rama
`feature/inventario-jwt` (commit `7fa8af6`), con el `compose.yml` del TP6 más `JWT_SECRET` y
`JWT_ISSUER` en los 3 nodos (lo que agrega el PR de Compose de la Parte 1). Los tokens se generaron con
[`scripts/token.js`](../../scripts/token.js) usando el mismo `JWT_SECRET` del `.env`. En la
evidencia los tokens aparecen cortados (`eyJhbGciOi…`): nunca se pegan completos.

Preparación (desde la raíz, con el `.env` que define `JWT_SECRET`):

```bash
docker compose up --build -d
P=<id de un producto de Catálogo>        # por ejemplo, uno de node scripts/seed.js
ADMIN=$(node scripts/token.js --rol ADMIN --sub admin-1)
CLIENTE=$(node scripts/token.js --rol CLIENTE --sub cliente-1)
SERVICIO=$(node scripts/token.js --rol SERVICIO --sub ventas-service)
```

Salida completa (el Leader era `inventario-2`, puerto 3202; el follower usado, `inventario-1`, puerto 3201):

```text
Leader en 3202 · follower en 3201
Producto de prueba en Catálogo: 6ae23906f90f4f7e8e2750e2
Tokens: ADMIN eyJhbGciOiJIUzI1NiIs… · CLIENTE eyJhbGciOiJIUzI1NiIs… · SERVICIO eyJhbGciOiJIUzI1NiIs…

== 1. Autenticación (401) sobre PUT /stock/:productoId
Sin header Authorization                                   -> 401 {"error":"Token ausente","servicio":"inventario-service"} [WWW-Authenticate: Bearer]
Esquema Basic en vez de Bearer                             -> 401 {"error":"Token ausente","servicio":"inventario-service"} [WWW-Authenticate: Bearer]
Token mal formado (Bearer abc.def)                         -> 401 {"error":"Token inválido","servicio":"inventario-service"} [WWW-Authenticate: Bearer]
Token CLIENTE con el payload cambiado a ADMIN              -> 401 {"error":"Token inválido","servicio":"inventario-service"} [WWW-Authenticate: Bearer]
Token firmado con otro secreto                             -> 401 {"error":"Token inválido","servicio":"inventario-service"} [WWW-Authenticate: Bearer]
Token con alg none (sin firma)                             -> 401 {"error":"Token inválido","servicio":"inventario-service"} [WWW-Authenticate: Bearer]
Token vencido                                              -> 401 {"error":"Token vencido","servicio":"inventario-service"} [WWW-Authenticate: Bearer]
Token bien firmado pero sin claim role                     -> 401 {"error":"Token inválido","servicio":"inventario-service"} [WWW-Authenticate: Bearer]
Token bien firmado con otro iss                            -> 401 {"error":"Token inválido","servicio":"inventario-service"} [WWW-Authenticate: Bearer]

== 2. Autorización (403): identidad válida, rol insuficiente
CLIENTE en PUT /stock (solo ADMIN)                         -> 403 {"error":"Permisos insuficientes","servicio":"inventario-service"}
CLIENTE en POST /descuentos (solo SERVICIO o ADMIN)        -> 403 {"error":"Permisos insuficientes","servicio":"inventario-service"}
SERVICIO en PUT /stock (solo ADMIN)                        -> 403 {"error":"Permisos insuficientes","servicio":"inventario-service"}
CLIENTE en GET /movimientos (solo ADMIN)                   -> 403 {"error":"Permisos insuficientes","servicio":"inventario-service"}

== 3. Rol autorizado (operación correcta)
ADMIN en PUT /stock (alta, con C4 a Catálogo)             -> 200 {"productoId":"6ae23906f90f4f7e8e2750e2","stock":10}
SERVICIO en POST /descuentos con usuarioId                 -> 201 {"referencia":"compra-seg-1","items":[{"productoId":"6ae23906f90f4f7e8e2750e2","cantidad":2}]}
SERVICIO en DELETE /descuentos/compra-seg-1                -> 204

== 4. Endpoints públicos
GET /stock sin token                                       -> 200 [{"productoId":"6ae23906f90f4f7e8e2750e2","stock":10}]
GET /api/cluster/estado sin token                          -> 200 {"nodo":"inventario-2","rol":"LEADER", …}
GET /api/cluster/log sin token                             -> 401 {"error":"Token ausente","servicio":"inventario-service"} [WWW-Authenticate: Bearer]
GET /api/cluster/log con ADMIN                             -> 200

== 5. Escrituras por un follower (3201): se reenvían con el Authorization
ADMIN en PUT /stock por el follower                        -> 200 {"productoId":"6ae23906f90f4f7e8e2750e2","stock":20}
CLIENTE en PUT /stock por el follower (rechaza sin reenviar) -> 403 {"error":"Permisos insuficientes","servicio":"inventario-service"}

== 6. Trazabilidad: GET /movimientos con ADMIN
  #2 ALTA         10 -> stock  10  usuarioId: admin-1
  #3 DESCUENTO    -2 -> stock   8  usuarioId: cliente-1 (compra-seg-1)
  #4 REINTEGRO     2 -> stock  10  usuarioId: ventas-service (compra-seg-1)
  #5 AJUSTE       10 -> stock  20  usuarioId: admin-1
```

## Logs

```bash
docker compose logs inventario-1 inventario-2 inventario-3 | grep -c "eyJ"     # tokens en los logs
```

```text
0
```

Ningún token aparece en los logs. Los rechazos se registran con servicio, nodo, operación y motivo:

```text
{"level":"warn","message":"Request rechazada por autenticación","motivo":"Token ausente","nodo":"inventario-2","operacion":"PUT /stock/6ae23906f90f4f7e8e2750e2","servicio":"inventario-service","status":401,"timestamp":"2026-10-28T18:03:50.422Z"}
```

## Resumen

| Caso | Esperado | Obtenido |
|---|---|---|
| Sin token / esquema Basic | 401 "Token ausente" | ✅ |
| Mal formado, payload alterado, otra clave, `alg: none`, sin `role`, otro `iss` | 401 "Token inválido" | ✅ |
| Vencido (generado vencido y vencido esperando) | 401 "Token vencido" | ✅ |
| `WWW-Authenticate: Bearer` en cada 401 | sí | ✅ |
| CLIENTE o SERVICIO en una operación de otro rol | 403 "Permisos insuficientes" | ✅ |
| ADMIN y SERVICIO en sus operaciones | 200 / 201 / 204 | ✅ |
| Escritura por un follower | El ADMIN se reenvía al Leader (200); el CLIENTE se rechaza en el follower (403) | ✅ |
| `usuarioId` en los movimientos | ALTA/AJUSTE del ADMIN, DESCUENTO del cliente, REINTEGRO del servicio | ✅ |
| Endpoints públicos (`GET /stock`, `GET /api/cluster/estado`) | 200 sin token | ✅ |
| Tokens en los logs | ninguno | ✅ |
