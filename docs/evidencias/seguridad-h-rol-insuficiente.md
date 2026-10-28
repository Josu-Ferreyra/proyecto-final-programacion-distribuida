# Evidencia · H — Usuario válido sin rol suficiente

**Objetivo (TP7 §19, escenario H):** una identidad válida, pero sin el rol que pide la operación, recibe
`403` (no `401`): el token es correcto y lo que falta es autorización (TP7 §11.1).

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

Detalle completo de la corrida: [`seguridad-inventario-middleware.md`](./seguridad-inventario-middleware.md).

```bash
curl -i -X PUT localhost:3202/stock/$P -H "Authorization: Bearer $CLIENTE" -H "Content-Type: application/json" -d '{"cantidad":10}'
curl -i -X POST localhost:3202/descuentos -H "Authorization: Bearer $CLIENTE" -H "Content-Type: application/json" \
  -d '{"referencia":"c-directo","items":[{"productoId":"'$P'","cantidad":1}]}'
curl -i -X PUT localhost:3202/stock/$P -H "Authorization: Bearer $SERVICIO" -H "Content-Type: application/json" -d '{"cantidad":10}'
curl -i "localhost:3202/movimientos?productoId=$P" -H "Authorization: Bearer $CLIENTE"
curl -i -X PUT localhost:3201/stock/$P -H "Authorization: Bearer $CLIENTE" -H "Content-Type: application/json" -d '{"cantidad":20}'   # por un follower
```

```text
CLIENTE en PUT /stock (solo ADMIN)                         -> 403 {"error":"Permisos insuficientes","servicio":"inventario-service"}
CLIENTE en POST /descuentos (solo SERVICIO o ADMIN)        -> 403 {"error":"Permisos insuficientes","servicio":"inventario-service"}
SERVICIO en PUT /stock (solo ADMIN)                        -> 403 {"error":"Permisos insuficientes","servicio":"inventario-service"}
CLIENTE en GET /movimientos (solo ADMIN)                   -> 403 {"error":"Permisos insuficientes","servicio":"inventario-service"}
CLIENTE en PUT /stock por el follower (rechaza sin reenviar) -> 403 {"error":"Permisos insuficientes","servicio":"inventario-service"}
```

**Resultado:** `403 "Permisos insuficientes"`. El caso más importante es el segundo: un `CLIENTE` no puede
descontar stock llamando directo a Inventario, salteando Ventas (D13). Un follower rechaza el `403`
sin reenviar la escritura al Leader.

Log del rechazo (sin token, con quién lo intentó):

```text
{"level":"warn","message":"Request rechazada por autorización","nodo":"inventario-2","operacion":"PUT /stock/6ae23906f90f4f7e8e2750e2","rol":"CLIENTE","rolesPermitidos":["ADMIN"],"servicio":"inventario-service","status":403,"timestamp":"2026-10-28T18:03:51.700Z","usuarioId":"cliente-1"}
```

> **Catálogo:** la misma prueba sobre `POST /productos con un token CLIENTE` se agrega cuando se mergea la protección de
> Catálogo (Parte 1). Usa la misma copia del middleware, así que el resultado esperado es idéntico.

> **Ventas:** la regla de propiedad (un cliente consulta la compra de otro → `403`) es de la Parte 3.
