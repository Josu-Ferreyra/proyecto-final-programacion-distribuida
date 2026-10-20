# Servicio de Catálogo

Define **qué productos se ofrecen, con qué nombre, en qué categoría y a qué precio**
(ficha de Catálogo en [`docs/04-microservicios.md`](../../docs/04-microservicios.md#servicio-catálogo)).
No guarda stock ni conoce Raft ni Redis, y no depende de ningún otro servicio.

Responsable: Josué Ferreyra (Parte 1 del TP6).

## Ejecutar sin Docker

Requisitos: Node.js 24 LTS y un MongoDB local en `127.0.0.1:27017`.

```bash
cd services/catalogo
cp .env.example .env
npm install
npm start
```

```bash
curl http://localhost:3100/health
curl -X POST http://localhost:3100/productos -H "Content-Type: application/json" \
  -d '{"nombre":"Teclado","precio":45000,"categoria":"periferico"}'
curl http://localhost:3100/productos
```

> En PowerShell usar `curl.exe` en lugar de `curl`.

Swagger: <http://localhost:3100/api-docs> (especificación en `/api-docs.json`).

## Variables de entorno

| Variable | Por defecto | Para qué |
|---|---|---|
| `SERVICE_NAME` | `catalogo-service` | Nombre en logs, en `/health` y en el campo `servicio` de los errores |
| `PORT` | `3100` | Puerto HTTP |
| `MONGODB_URI` | — (obligatoria) | Base propia: `mongodb://127.0.0.1:27017/catalogo` local · `mongodb://catalogo-db:27017/catalogo` en Compose |
| `LOG_LEVEL` | `info` | Nivel de Winston |
| `MONGODB_CONNECT_RETRIES` | `10` | Intentos de conexión a Mongo al arrancar |
| `MONGODB_RETRY_MS` | `3000` | Espera entre intentos |
| `NODE_ENV` | — | Con `production` los logs salen en JSON |

## Endpoints

| Endpoint | Respuestas |
|---|---|
| `GET /health` | `200 { service, status: "ok" }` (no consulta la base) |
| `GET /productos?nombreContiene=&categoria=` | `200 [Producto]` · `400` filtro inválido |
| `GET /productos/:id` | `200` · `400` id mal formado · `404` |
| `POST /productos` `{ nombre, precio, categoria? }` | `201` · `400` · `409` nombre repetido |
| `PUT /productos/:id` | `200` · `400` · `404` · `409` |
| `DELETE /productos/:id` | `204` · `400` · `404` |

Todas las rutas de `/productos` responden `503 { error, servicio }` si la base no está
disponible; el proceso sigue vivo y vuelve a responder cuando la base vuelve.

## Estructura

```
src/
├── server.js        ← arranque: conecta a Mongo con reintentos y abre el puerto
├── app.js           ← Express, Swagger, manejo de errores
├── config/          ← variables de entorno, logger, conexión a Mongo, especificación OpenAPI
├── routes/          ← paths de la API
├── controllers/     ← HTTP ↔ servicio
├── services/        ← reglas de negocio (R1 nombre, R2 único, R3 precio, R5 categoría)
└── models/          ← schema de Producto y lista única de categorías
```
