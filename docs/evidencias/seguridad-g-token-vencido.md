# Evidencia · G — Token vencido

**Objetivo (TP7 §19, escenario G):** un token con `exp` en el pasado responde `401`.

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

**1. Token ya vencido** (`exp` un minuto antes de emitirlo):

```bash
curl -i -X PUT localhost:3202/stock/$P -H "Authorization: Bearer $(node scripts/token.js --rol ADMIN --vencido)" \
  -H "Content-Type: application/json" -d '{"cantidad":10}'
```

```text
Token vencido                                              -> 401 {"error":"Token vencido","servicio":"inventario-service"} [WWW-Authenticate: Bearer]
```

**2. Token que vence mientras se usa** (vigencia de un minuto, la misma request antes y después):

```bash
T=$(node scripts/token.js --rol ADMIN --minutos 1)
node scripts/token.js --rol ADMIN --minutos 1 --decodificar     # muestra iat y exp
curl "localhost:3202/movimientos?productoId=$P" -H "Authorization: Bearer $T"     # recién emitido
sleep 65
curl "localhost:3202/movimientos?productoId=$P" -H "Authorization: Bearer $T"     # 65 s después
```

```text
{"sub":"prueba-admin","role":"ADMIN","iss":"auth-service","iat":1793210652,"exp":1793210712}
15:04:12 con el token recién emitido: [{"productoId":"6ae23906f90f4f7e8e2750e2","indiceRaft":2,…}] [200]
15:05:17 el mismo token, 65 s después: {"error":"Token vencido","servicio":"inventario-service"} [401]
```

**Resultado:** `401 "Token vencido"`. El mismo token que funcionaba deja de valer cuando pasa su `exp`.
Los tokens reales de `auth-service` vencen a los `JWT_EXPIRES_IN` (15 minutos por defecto, D9).

> **Catálogo:** la misma prueba sobre `POST /productos` se agrega cuando se mergea la protección de
> Catálogo (Parte 1). Usa la misma copia del middleware, así que el resultado esperado es idéntico.
