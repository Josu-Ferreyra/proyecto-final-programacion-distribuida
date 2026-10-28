# Evidencia · I — Usuario con rol autorizado

**Objetivo (TP7 §19, escenario I):** con el rol correcto, la operación se ejecuta normalmente.

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
curl -X PUT localhost:3202/stock/$P -H "Authorization: Bearer $ADMIN" -H "Content-Type: application/json" -d '{"cantidad":10}'
curl -X POST localhost:3202/descuentos -H "Authorization: Bearer $SERVICIO" -H "Content-Type: application/json" \
  -d '{"referencia":"compra-seg-1","items":[{"productoId":"'$P'","cantidad":2}],"usuarioId":"cliente-1"}'
curl -X DELETE localhost:3202/descuentos/compra-seg-1 -H "Authorization: Bearer $SERVICIO"
curl -X PUT localhost:3201/stock/$P -H "Authorization: Bearer $ADMIN" -H "Content-Type: application/json" -d '{"cantidad":20}'   # por un follower
curl "localhost:3202/movimientos?productoId=$P" -H "Authorization: Bearer $ADMIN"
```

```text
ADMIN en PUT /stock (alta, con C4 a Catálogo)             -> 200 {"productoId":"6ae23906f90f4f7e8e2750e2","stock":10}
SERVICIO en POST /descuentos con usuarioId                 -> 201 {"referencia":"compra-seg-1","items":[{"productoId":"6ae23906f90f4f7e8e2750e2","cantidad":2}]}
SERVICIO en DELETE /descuentos/compra-seg-1                -> 204
GET /api/cluster/log con ADMIN                             -> 200
ADMIN en PUT /stock por el follower                        -> 200 {"productoId":"6ae23906f90f4f7e8e2750e2","stock":20}
```

Movimientos registrados (`GET /movimientos` con ADMIN):

```text
  #2 ALTA         10 -> stock  10  usuarioId: admin-1
  #3 DESCUENTO    -2 -> stock   8  usuarioId: cliente-1 (compra-seg-1)
  #4 REINTEGRO     2 -> stock  10  usuarioId: ventas-service (compra-seg-1)
  #5 AJUSTE       10 -> stock  20  usuarioId: admin-1
```

**Resultado:** `ADMIN` da de alta y ajusta stock (también por un follower, que reenvía el
`Authorization` al Leader); `SERVICIO` descuenta y reintegra. Cada movimiento guarda quién lo originó: el
`DESCUENTO` tiene el `usuarioId` del cliente que mandó Ventas (D13).

> **Catálogo:** la misma prueba sobre `POST /productos con un token ADMIN` se agrega cuando se mergea la protección de
> Catálogo (Parte 1). Usa la misma copia del middleware, así que el resultado esperado es idéntico.
