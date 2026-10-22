# Servicio de Ventas

Concreta **las compras de los clientes y lleva su ciclo de vida**, dejando constancia de qué
se compró, cuánto y a qué precio (ficha de Ventas en
[`docs/04-microservicios.md`](../../docs/04-microservicios.md#servicio-ventas)).
Reemplaza a `comprarProducto` del TP4, que validaba, tomaba el lock, decidía el stock y
armaba el comando de Raft en una sola función (Caso 3 de `docs/03-acoplamientos.md`).

Responsable: Matías Porcari (Parte 3 del TP6).

| Ventas hace | Ventas **no** hace |
|---|---|
| Valida el formato del pedido (cantidad entera > 0, sin productos repetidos) | Consultar ni calcular stock: lo pide a Inventario |
| Pide a Catálogo nombre, precio y estado de los productos (C1) | Guardar precios vigentes ni modificar productos |
| Pide a Inventario descontar y reintegrar unidades (C2, C3) | Tomar locks ni conectarse a Redis |
| Guarda la compra con el precio pagado y el total | Saber que Inventario es un cluster Raft |
| Compensa un descuento que pudo quedar aplicado y reintenta los reintegros pendientes | Reintentar un descuento dentro del pedido del cliente |

## Endpoints

| Endpoint | Qué hace | Respuestas |
|---|---|---|
| `POST /compras` `{ items: [{ productoId, cantidad }] }` | Registra la compra (TP5 §6.5.1) | `201` · `400` (formato o `productosInexistentes`) · `409` (`productosInactivos` o `faltantes`) · `502` · `503` |
| `GET /compras/:id` | Consulta una compra; lee solo la base de Ventas | `200` · `400` · `404` |
| `PATCH /compras/:id/cancelar` | Cancela una compra `CONFIRMADA` (TP5 §6.5.2) | `200` `CANCELADA` · `202` `CANCELACION_PENDIENTE` · `404` · `409` |
| `GET /health` | `{ "service": "ventas-service", "status": "ok" }` | `200` |

Swagger: <http://localhost:3300/api-docs> (especificación en `/api-docs.json`).

Estados de una compra: `CONFIRMADA` → `CANCELACION_PENDIENTE` → `CANCELADA`. `FALLIDA`
(decisión D7) es una compra que no llegó a confirmarse y dejó un reintegro de stock
pendiente: el proceso de reintentos lo completa y pone `reintegroPendiente` en `false`.

Cómo responde Ventas a cada fallo de sus dependencias, y el análisis de fallo parcial:
[`docs/12-comunicacion-y-fallos.md`](../../docs/12-comunicacion-y-fallos.md).

## Ejecutar sin Docker

Requisitos: Node.js 24 LTS y un MongoDB local en `127.0.0.1:27017`.

```bash
cd services/ventas
cp .env.example .env
npm install
npm start
```

Ventas arranca aunque Catálogo e Inventario no estén levantados: el proceso queda sano y
las compras responden `503` hasta que las dependencias respondan.

### Contra los servicios reales

Levantar Catálogo (puerto 3100) y los 3 nodos de Inventario (3201–3203, ver
[`services/inventario/README.md`](../inventario/README.md)). El `.env.example` ya apunta a
esos puertos.

### Contra los mocks (sin los otros servicios)

`dev/mocks.js` simula C1, C2 y C3 en los puertos 3100 y 3201, así que **no** hay que
cambiar el `.env`. En otra terminal:

```bash
npm run mock                                   # escenario ok
MOCK_ESCENARIO=lento npm run mock              # PowerShell: $env:MOCK_ESCENARIO='lento'; npm run mock
```

| `MOCK_ESCENARIO` | C1 | C2 | C3 |
|---|---|---|---|
| `ok` | `200` con los productos | descuenta en memoria: `201`, `200` si se repite la referencia, `409 { faltantes }` | `204` · `404` si no había descuento |
| `inactivo` | el segundo producto con `activo: false` | como `ok` | como `ok` |
| `sin-stock` | `200` | `409 { faltantes }` | como `ok` |
| `lento` | `200` | tarda 5 s (más que el timeout de Ventas) y **después** aplica el descuento | como `ok` |
| `caido` | `503` | `503` | `503` |

Al arrancar, el mock muestra los ids de sus productos para usarlos en las pruebas:

```bash
curl -X POST http://localhost:3300/compras -H "Content-Type: application/json" \
  -d '{"items":[{"productoId":"6ad000000000000000000001","cantidad":2}]}'
```

> En PowerShell usar `curl.exe` en lugar de `curl`.

## Ejecutar con Docker (solo este servicio)

La imagen no incluye `.env`, `node_modules/` ni los mocks (ver `.dockerignore`): toda la
configuración se pasa con `-e`. Normalmente se levanta junto con el resto desde
[`compose.yml`](../../compose.yml); para probar la imagen sola:

```bash
docker network create tp6-prueba
docker run -d --rm --name ventas-db --network tp6-prueba mongo:7
docker build -t grupo/ventas:tp6 ./services/ventas
docker run --rm --network tp6-prueba -p 3300:3300 \
  -e SERVICE_NAME=ventas-service -e PORT=3300 \
  -e MONGODB_URI=mongodb://ventas-db:27017/ventas \
  -e CATALOGO_SERVICE_URL=http://catalogo-service:3100 \
  -e INVENTARIO_SERVICE_URL=http://inventario-service:3200 \
  grupo/ventas:tp6
# en otra terminal: curl http://localhost:3300/health
# una compra responde 503 (Catálogo no existe en esta red): el servicio no se cae
docker stop ventas-db && docker network rm tp6-prueba
```

## Variables de entorno

| Variable | Por defecto | Para qué |
|---|---|---|
| `SERVICE_NAME` | `ventas-service` | Nombre en logs, en `/health` y en el campo `servicio` de los errores |
| `PORT` | `3300` | Puerto HTTP |
| `MONGODB_URI` | — (obligatoria) | Base propia: `mongodb://127.0.0.1:27017/ventas` local · `mongodb://ventas-db:27017/ventas` en Compose |
| `CATALOGO_SERVICE_URL` | — (obligatoria) | `http://localhost:3100` local · `http://catalogo-service:3100` en Compose |
| `INVENTARIO_SERVICE_URL` | — (obligatoria) | `http://localhost:3201` local · `http://inventario-service:3200` en Compose (alias de los 3 nodos, D1) |
| `HTTP_TIMEOUT_MS` | `3000` | Timeout de cada llamada a Catálogo o Inventario (TP5 §6) |
| `REINTENTO_REINTEGRO_MS` | `30000` | Cada cuánto se reintentan los reintegros pendientes |
| `LOG_LEVEL` | `info` | Nivel de Winston (`debug` muestra además cada respuesta de las dependencias) |
| `MONGODB_CONNECT_RETRIES` | `10` | Intentos de conexión a Mongo al arrancar |
| `MONGODB_RETRY_MS` | `3000` | Espera entre intentos |
| `NODE_ENV` | — | Con `production` los logs salen en JSON |

## Estructura

```
src/
├── server.js              ← arranque: Mongo con reintentos, API y proceso de reintentos
├── app.js                 ← Express, Swagger y manejo de errores ({ error, servicio, ... })
├── config/                ← env.js (variables), logger.js (Winston por stdout), db.js, swagger.js
├── routes/                ← compras.routes.js, health.routes.js
├── controllers/           ← traducen HTTP ↔ servicio
├── services/
│   ├── comprasService.js  ← registrar (C1, C2, compensación), consultar y cancelar (C3)
│   └── reintentos.js      ← reintegros pendientes cada REINTENTO_REINTEGRO_MS
├── clients/               ← único lugar con fetch: httpClient.js (timeout y clasificación
│                             de errores), catalogoClient.js (C1), inventarioClient.js (C2, C3)
├── errors/                ← ErrorNegocio, DependenciaNoDisponible, RespuestaRemota
└── models/                ← compra.model.js (compras e ítems con precio pagado)
dev/mocks.js               ← mocks de C1–C3 (no entran en la imagen)
```

Ninguna URL ni host está escrito en el código, y Ventas no importa código de otro
servicio ni accede a su base: solo usa los contratos C1–C3 de
[`docs/06-comunicaciones.md`](../../docs/06-comunicaciones.md#62-matriz-de-comunicaciones).
