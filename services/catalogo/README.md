# Servicio de Catálogo

Define **qué productos se ofrecen, con qué nombre, en qué categoría y a qué precio**
(ficha de Catálogo en [`docs/04-microservicios.md`](../../docs/04-microservicios.md#servicio-catálogo)).
No guarda stock ni conoce Raft ni Redis, y no depende de ningún otro servicio.

Desde el TP7 las consultas siguen siendo públicas, pero dar de alta, modificar o dar de baja un
producto pide un JWT de `auth-service` con rol `ADMIN` (matriz de
[`docs/14-modelo-seguridad.md`](../../docs/14-modelo-seguridad.md)). El token se valida localmente:
Catálogo no llama a `auth-service`.

Responsable: Josué Ferreyra (Parte 1 del TP6 y del TP7).

## Ejecutar sin Docker

Requisitos: Node.js 24 LTS y un MongoDB local en `127.0.0.1:27017`.

```bash
cd services/catalogo
cp .env.example .env       # y poner en JWT_SECRET el mismo valor que en auth-service
npm install
npm start
```

```bash
curl http://localhost:3100/health
curl http://localhost:3100/productos
# Escrituras: token ADMIN de auth-service (o, en desarrollo, node scripts/token.js --rol ADMIN)
TOKEN=$(curl -s -X POST http://localhost:3400/auth/login -H "Content-Type: application/json" \
  -d '{"email":"admin@tp7.local","password":"<ADMIN_PASSWORD>"}' | node -pe 'JSON.parse(require("fs").readFileSync(0)).accessToken')
curl -X POST http://localhost:3100/productos -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" -d '{"nombre":"Teclado","precio":45000,"categoria":"periferico"}'
```

> En PowerShell usar `curl.exe` en lugar de `curl`.

Swagger: <http://localhost:3100/api-docs> (especificación en `/api-docs.json`). Para probar las
escrituras desde Swagger: botón **Authorize** y pegar el token (sin la palabra `Bearer`).

## Ejecutar con Docker (solo este servicio)

La imagen no incluye `.env` ni `node_modules/` (ver `.dockerignore`): toda la
configuración se pasa con `-e`. Normalmente se levanta junto con el resto desde
[`compose.yml`](../../compose.yml); para probar la imagen sola:

```bash
docker network create tp6-prueba
docker run -d --rm --name catalogo-db --network tp6-prueba mongo:7
docker build -t grupo/catalogo:tp6 ./services/catalogo
docker run --rm --network tp6-prueba -p 3100:3100 \
  -e SERVICE_NAME=catalogo-service -e PORT=3100 -e JWT_SECRET="$JWT_SECRET" \
  -e MONGODB_URI=mongodb://catalogo-db:27017/catalogo grupo/catalogo:tp6
# en otra terminal: curl http://localhost:3100/health
docker stop catalogo-db && docker network rm tp6-prueba
```

## Variables de entorno

| Variable | Por defecto | Para qué |
|---|---|---|
| `SERVICE_NAME` | `catalogo-service` | Nombre en logs, en `/health` y en el campo `servicio` de los errores |
| `PORT` | `3100` | Puerto HTTP |
| `MONGODB_URI` | — (obligatoria) | Base propia: `mongodb://127.0.0.1:27017/catalogo` local · `mongodb://catalogo-db:27017/catalogo` en Compose |
| `JWT_SECRET` | — (obligatoria, ≥ 32 caracteres) | Clave HS256 para validar los tokens; la misma que en `auth-service`. El servicio no arranca sin ella |
| `JWT_ISSUER` | `auth-service` | Emisor esperado (claim `iss`) |
| `LOG_LEVEL` | `info` | Nivel de Winston |
| `MONGODB_CONNECT_RETRIES` | `10` | Intentos de conexión a Mongo al arrancar |
| `MONGODB_RETRY_MS` | `3000` | Espera entre intentos |
| `NODE_ENV` | — | Con `production` los logs salen en JSON |

## Endpoints

| Endpoint | Acceso | Respuestas |
|---|---|---|
| `GET /health` | Público | `200 { service, status: "ok" }` (no consulta la base) |
| `GET /productos?nombreContiene=&categoria=` | Público | `200 [Producto]` con `activo` en cada uno · `400` filtro inválido |
| `GET /productos?ids=a,b,c` | Público | Contrato **C1** (Ventas): `200 [{ id, nombre, precio, activo, … }]`; los ids inexistentes o mal formados no aparecen |
| `GET /productos/:id` | Público | Contrato **C4** (Inventario): `200` · `400` id mal formado · `404` |
| `POST /productos` `{ nombre, precio, categoria? }` | `ADMIN` | `201` · `400` (también si viene `stock`) · `401` · `403` · `409` nombre repetido |
| `PUT /productos/:id` `{ nombre?, precio?, categoria? }` | `ADMIN` | `200` · `400` (también si viene `stock`: se ajusta en Inventario) · `401` · `403` · `404` · `409` |
| `GET /categorias` | Público | `200 ["periferico", "monitor", "accesorio", "otro"]` (no consulta la base) |
| `DELETE /productos/:id` | `ADMIN` | Baja lógica (`activo = false`): `204`, también si se repite · `400` · `401` · `403` · `404` |

`401 { error, servicio }` con `WWW-Authenticate: Bearer` y `error` = `Token ausente`,
`Token inválido` o `Token vencido`; `403 { error: "Permisos insuficientes", servicio }` si el rol
no es `ADMIN` (D14).

Todas las rutas de `/productos` responden `503 { error, servicio }` si la base no está
disponible; el proceso sigue vivo y vuelve a responder cuando la base vuelve.

## Estructura

```
src/
├── server.js        ← arranque: conecta a Mongo con reintentos y abre el puerto
├── app.js           ← Express, Swagger, manejo de errores
├── config/          ← variables de entorno, logger, conexión a Mongo, especificación OpenAPI
├── middlewares/     ← auth.js: validación del JWT y del rol (copia del de Inventario)
├── routes/          ← paths de la API
├── controllers/     ← HTTP ↔ servicio
├── services/        ← reglas de negocio (R1 nombre, R2 único, R3 precio, R5 categoría)
└── models/          ← schema de Producto y lista única de categorías
```
