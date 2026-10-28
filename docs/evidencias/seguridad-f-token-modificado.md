# Evidencia · F — Token modificado manualmente

**Objetivo (TP7 §19, escenario F):** si alguien altera el token, la firma deja de coincidir y la
solicitud responde `401`.

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

Se tomó un token `CLIENTE` válido y se cambió `"role":"CLIENTE"` por `"role":"ADMIN"` en la parte del
medio (el payload), sin volver a firmarlo:

```bash
MOD=$(node -e '
const [h, p, s] = process.argv[1].split(".");
const payload = JSON.parse(Buffer.from(p, "base64url")); payload.role = "ADMIN";
console.log([h, Buffer.from(JSON.stringify(payload)).toString("base64url"), s].join("."));' "$CLIENTE")
curl -i -X PUT localhost:3202/stock/$P -H "Authorization: Bearer $MOD" -H "Content-Type: application/json" -d '{"cantidad":10}'
```

Variantes del mismo ataque:

```text
Token mal formado (Bearer abc.def)                         -> 401 {"error":"Token inválido","servicio":"inventario-service"} [WWW-Authenticate: Bearer]
Token CLIENTE con el payload cambiado a ADMIN              -> 401 {"error":"Token inválido","servicio":"inventario-service"} [WWW-Authenticate: Bearer]
Token firmado con otro secreto                             -> 401 {"error":"Token inválido","servicio":"inventario-service"} [WWW-Authenticate: Bearer]
Token con alg none (sin firma)                             -> 401 {"error":"Token inválido","servicio":"inventario-service"} [WWW-Authenticate: Bearer]
Token bien firmado pero sin claim role                     -> 401 {"error":"Token inválido","servicio":"inventario-service"} [WWW-Authenticate: Bearer]
Token bien firmado con otro iss                            -> 401 {"error":"Token inválido","servicio":"inventario-service"} [WWW-Authenticate: Bearer]
```

**Resultado:** `401 "Token inválido"` en todos los casos. El servicio no acepta un payload alterado, ni un
token firmado con otra clave (`--secreto-falso`), ni uno sin firma (`alg: none`), ni uno de otro emisor:
`jsonwebtoken` se configura con `algorithms: ['HS256']` e `issuer: 'auth-service'` (TP7 §8.1).

> **Catálogo:** la misma prueba sobre `POST /productos` se agrega cuando se mergea la protección de
> Catálogo (Parte 1). Usa la misma copia del middleware, así que el resultado esperado es idéntico.
