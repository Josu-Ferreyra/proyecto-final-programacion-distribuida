# Evidencia · E — Endpoint protegido sin token

**Objetivo (TP7 §19, escenario E):** un endpoint protegido responde `401` cuando la solicitud no trae
token, o lo trae con otro esquema.

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
curl -i -X PUT localhost:3202/stock/$P -H "Content-Type: application/json" -d '{"cantidad":10}'
curl -i -X PUT localhost:3202/stock/$P -H "Authorization: Basic YWRtaW46YWRtaW4=" -H "Content-Type: application/json" -d '{"cantidad":10}'
curl -i "localhost:3202/api/cluster/log?desde=1&hasta=1"
```

```text
Sin header Authorization                                   -> 401 {"error":"Token ausente","servicio":"inventario-service"} [WWW-Authenticate: Bearer]
Esquema Basic en vez de Bearer                             -> 401 {"error":"Token ausente","servicio":"inventario-service"} [WWW-Authenticate: Bearer]
GET /api/cluster/log sin token                             -> 401 {"error":"Token ausente","servicio":"inventario-service"} [WWW-Authenticate: Bearer]
```

**Resultado:** `401 "Token ausente"` con el header `WWW-Authenticate: Bearer`. Los endpoints públicos
(`GET /stock`, `GET /api/cluster/estado`) siguen respondiendo `200` sin token.

> **Catálogo:** la misma prueba sobre `POST /productos` se agrega cuando se mergea la protección de
> Catálogo (Parte 1). Usa la misma copia del middleware, así que el resultado esperado es idéntico.
