# Logs

**Objetivo:** los logs de cada servicio salen por stdout y cada línea indica servicio,
nivel, operación y, si corresponde, el error.

```bash
docker compose logs --tail 20
docker compose logs catalogo-service
docker compose logs -f catalogo-service &
curl http://localhost:3100/productos/65f1a2b3c4d5e6f7a8b9c0d1          # 404
curl -X POST http://localhost:3100/productos -H "Content-Type: application/json" \
  -d '{"nombre":"Duplicado","precio":10}'
curl -X POST http://localhost:3100/productos -H "Content-Type: application/json" \
  -d '{"nombre":"Duplicado","precio":10}'                                # 409
docker compose logs -f ventas-service       # con Ventas levantado: provocar un 404 y un 409
```

## Salida obtenida

Corrida del 2026-10-20 en un clon limpio de la rama `docs/tp6-deployment` (commit `79b2e3a`), antes del merge a `main`. Inventario y Ventas todavía no tienen Dockerfile, así que sus bloques de `compose.yml` están comentados y esta corrida cubre Catálogo, las tres bases y Redis. **Se repite sobre `main` con los tres servicios antes del tag `tp6-entrega`.**

```text
$ cd tp6-limpio

$ curl -s http://localhost:3100/productos/65f1a2b3c4d5e6f7a8b9c0d1
{"error":"Producto con id 65f1a2b3c4d5e6f7a8b9c0d1 no encontrado","servicio":"catalogo-service"}
$ curl -s -X POST http://localhost:3100/productos -H "Content-Type: application/json" -d '{"nombre":"Duplicado","precio":10}'
{"id":"6ad7f3f6839082a71a46840f","nombre":"Duplicado","precio":10,"categoria":"otro","activo":true,"createdAt":"2026-10-20T23:06:30.724Z","updatedAt":"2026-10-20T23:06:30.724Z"}
$ curl -s -X POST http://localhost:3100/productos -H "Content-Type: application/json" -d '{"nombre":"Duplicado","precio":10}'
{"error":"Ya existe un producto con el nombre \"Duplicado\"","servicio":"catalogo-service"}
$ curl -s -X PUT http://localhost:3100/productos/65f1a2b3c4d5e6f7a8b9c0d1 -H "Content-Type: application/json" -d '{"stock":5}'
{"error":"El stock no se modifica en Catálogo: se ajusta con PUT /stock/:productoId en Inventario","servicio":"catalogo-service"}
$ docker compose logs --no-log-prefix catalogo-service | tail -9
{"level":"info","message":"API escuchando en el puerto 3100 (docs: /api-docs)","operacion":"arranque","servicio":"catalogo-service","timestamp":"2026-10-20T23:06:05.178Z"}
{"error":"Producto con id 65f1a2b3c4d5e6f7a8b9c0d1 no encontrado","level":"warn","message":"Request rechazada","operacion":"GET /productos/65f1a2b3c4d5e6f7a8b9c0d1","servicio":"catalogo-service","status":404,"timestamp":"2026-10-20T23:06:30.702Z"}
{"level":"info","message":"Request","method":"GET","ms":8,"servicio":"catalogo-service","status":404,"timestamp":"2026-10-20T23:06:30.702Z","url":"/productos/65f1a2b3c4d5e6f7a8b9c0d1"}
{"id":"6ad7f3f6839082a71a46840f","level":"info","message":"Producto creado","nombre":"Duplicado","operacion":"productos.crear","servicio":"catalogo-service","timestamp":"2026-10-20T23:06:30.728Z"}
{"level":"info","message":"Request","method":"POST","ms":14,"servicio":"catalogo-service","status":201,"timestamp":"2026-10-20T23:06:30.728Z","url":"/productos"}
{"error":"Ya existe un producto con el nombre \"Duplicado\"","level":"warn","message":"Request rechazada","operacion":"POST /productos","servicio":"catalogo-service","status":409,"timestamp":"2026-10-20T23:06:30.737Z"}
{"level":"info","message":"Request","method":"POST","ms":2,"servicio":"catalogo-service","status":409,"timestamp":"2026-10-20T23:06:30.737Z","url":"/productos"}
{"error":"El stock no se modifica en Catálogo: se ajusta con PUT /stock/:productoId en Inventario","level":"warn","message":"Request rechazada","operacion":"PUT /productos/65f1a2b3c4d5e6f7a8b9c0d1","servicio":"catalogo-service","status":400,"timestamp":"2026-10-20T23:06:30.743Z"}
{"level":"info","message":"Request","method":"PUT","ms":1,"servicio":"catalogo-service","status":400,"timestamp":"2026-10-20T23:06:30.744Z","url":"/productos/65f1a2b3c4d5e6f7a8b9c0d1"}

$ docker compose logs --tail 2
catalogo-service-1  | {"error":"El stock no se modifica en Catálogo: se ajusta con PUT /stock/:productoId en Inventario","level":"warn","message":"Request rechazada","operacion":"PUT /productos/65f1a2b3c4d5e6f7a8b9c0d1","servicio":"catalogo-service","status":400,"timestamp":"2026-10-20T23:06:30.743Z"}
catalogo-service-1  | {"level":"info","message":"Request","method":"PUT","ms":1,"servicio":"catalogo-service","status":400,"timestamp":"2026-10-20T23:06:30.744Z","url":"/productos/65f1a2b3c4d5e6f7a8b9c0d1"}
inventario-db-1     | {"t":{"$date":"2026-10-20T23:06:24.973+00:00"},"s":"I",  "c":"NETWORK",  "id":22944,   "ctx":"conn13","msg":"Connection ended","attr":{"remote":"127.0.0.1:50984","isLoadBalanced":false,"uuid":{"uuid":{"$uuid":"a5430454-ae4a-4b74-94c2-ae0f7c74551b"}},"connectionId":13,"connectionCount":1}}
inventario-db-1     | {"t":{"$date":"2026-10-20T23:06:24.973+00:00"},"s":"I",  "c":"NETWORK",  "id":22944,   "ctx":"conn12","msg":"Connection ended","attr":{"remote":"127.0.0.1:50974","isLoadBalanced":false,"uuid":{"uuid":{"$uuid":"656e437f-be71-492f-af32-c26c3e8d5bcb"}},"connectionId":12,"connectionCount":0}}
redis-1             | 1:M 20 Oct 2026 23:05:59.098 * Server initialized
redis-1             | 1:M 20 Oct 2026 23:05:59.098 * Ready to accept connections tcp
catalogo-db-1       | {"t":{"$date":"2026-10-20T23:06:25.124+00:00"},"s":"I",  "c":"NETWORK",  "id":22944,   "ctx":"conn16","msg":"Connection ended","attr":{"remote":"127.0.0.1:51078","isLoadBalanced":false,"uuid":{"uuid":{"$uuid":"30ab1393-0dee-4222-a9d6-f2417560dde9"}},"connectionId":16,"connectionCount":4}}
ventas-db-1         | {"t":{"$date":"2026-10-20T23:06:25.089+00:00"},"s":"I",  "c":"NETWORK",  "id":22944,   "ctx":"conn13","msg":"Connection ended","attr":{"remote":"127.0.0.1:51056","isLoadBalanced":false,"uuid":{"uuid":{"$uuid":"a6a4c320-2b9d-4d37-bc01-930137f714cd"}},"connectionId":13,"connectionCount":1}}
ventas-db-1         | {"t":{"$date":"2026-10-20T23:06:25.089+00:00"},"s":"I",  "c":"NETWORK",  "id":22944,   "ctx":"conn12","msg":"Connection ended","attr":{"remote":"127.0.0.1:51028","isLoadBalanced":false,"uuid":{"uuid":{"$uuid":"c1a2eb6f-e79d-4a90-a838-26128ff1b433"}},"connectionId":12,"connectionCount":0}}
catalogo-db-1       | {"t":{"$date":"2026-10-20T23:06:25.124+00:00"},"s":"I",  "c":"NETWORK",  "id":22944,   "ctx":"conn15","msg":"Connection ended","attr":{"remote":"127.0.0.1:51052","isLoadBalanced":false,"uuid":{"uuid":{"$uuid":"e0326c66-be7c-451b-a2c0-8cabd9a72595"}},"connectionId":15,"connectionCount":3}}
```

**Resultado:** ✅ cada línea de Catálogo es JSON con `servicio`, `level`, `operacion` (o `url`), `status` y `error` en los rechazos (`404`, `409`, `400` por `stock`). `docker compose logs` mezcla todos los contenedores con su prefijo. Ventas: pendiente (Parte 3).

**Resultado esperado:** líneas JSON con `servicio`, `level`, `operacion` (por ejemplo
`GET /productos/65f1…`), `status` y `error`.
