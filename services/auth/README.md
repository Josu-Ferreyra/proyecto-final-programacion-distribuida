# auth-service

Única autoridad sobre **credenciales** del sistema (decisión D8 de
[`docs/14-modelo-seguridad.md`](../../docs/14-modelo-seguridad.md)): registra usuarios, guarda la
password como hash bcrypt, la verifica en el login y emite el **access token JWT** que validan
Catálogo, Inventario y Ventas. No contiene reglas de negocio de los otros servicios y nadie lo
consulta por request: cada servicio valida el token localmente con el mismo `JWT_SECRET` (D15).

Responsable: Josué Ferreyra (Parte 1 del TP7). Diseño completo en
[`docs/15-identidad.md`](../../docs/15-identidad.md).

## Ejecutar sin Docker

Requisitos: Node.js 24 LTS y un MongoDB local en `127.0.0.1:27017`.

```bash
cd services/auth
cp .env.example .env       # y cambiar JWT_SECRET y las passwords por valores propios
npm install
npm start
```

```bash
curl -X POST http://localhost:3400/auth/register -H "Content-Type: application/json" \
  -d '{"email":"ana@ejemplo.com","password":"una-password-larga"}'
curl -X POST http://localhost:3400/auth/login -H "Content-Type: application/json" \
  -d '{"email":"ana@ejemplo.com","password":"una-password-larga"}'
# → { "accessToken": "eyJ…", "tokenType": "Bearer", "expiresIn": 900 }
curl http://localhost:3400/auth/me -H "Authorization: Bearer <accessToken>"
```

> En PowerShell usar `curl.exe` en lugar de `curl`.

Swagger: <http://localhost:3400/api-docs> (botón **Authorize** para pegar el token).

## Variables de entorno

| Variable | Por defecto | Para qué |
|---|---|---|
| `SERVICE_NAME` | `auth-service` | Nombre en logs, en `/health` y en el campo `servicio` de los errores |
| `PORT` | `3400` | Puerto HTTP |
| `MONGODB_URI` | — (obligatoria) | Base propia: `mongodb://127.0.0.1:27017/auth` local · `mongodb://auth-db:27017/auth` en Compose |
| `JWT_SECRET` | — (obligatoria, ≥ 32 caracteres) | Clave HS256, la misma en los 4 servicios. El servicio no arranca sin ella |
| `JWT_ISSUER` | `auth-service` | Claim `iss` del token |
| `JWT_EXPIRES_IN` | `15m` | Vencimiento del token (`900`, `30s`, `15m`, `1h`) |
| `BCRYPT_ROUNDS` | `12` | Costo de bcrypt (10 a 15) |
| `ADMIN_EMAIL` · `ADMIN_PASSWORD` | — | Primer `ADMIN`, se crea al arrancar si no existe |
| `VENTAS_SERVICE_EMAIL` · `VENTAS_SERVICE_PASSWORD` | — | Cuenta técnica de Ventas (rol `SERVICIO`), ídem |
| `LOG_LEVEL` | `info` | Nivel de Winston |
| `MONGODB_CONNECT_RETRIES` · `MONGODB_RETRY_MS` | `10` · `3000` | Reintentos de conexión a Mongo al arrancar |

## Endpoints

| Endpoint | Acceso | Respuestas |
|---|---|---|
| `POST /auth/register` `{ email, password }` | Público | `201 { id, email, rol: "CLIENTE", activo, createdAt }` · `400` · `409` email ya registrado. Si llega `rol`, se ignora |
| `POST /auth/login` `{ email, password }` | Público | `200 { accessToken, tokenType: "Bearer", expiresIn }` · `400` · `401 "Credenciales inválidas"` (usuario inexistente o password incorrecta, el mismo mensaje) · `403 "Cuenta deshabilitada"` |
| `GET /auth/me` | Autenticado | `200 { id, email, rol, activo }` · `401` · `404` si el usuario del token ya no existe |
| `POST /auth/usuarios` `{ email, password, rol }` | `ADMIN` | `201` · `400` (`rol` solo `ADMIN` o `CLIENTE`) · `401` · `403` · `409` |
| `PATCH /auth/usuarios/:id` `{ activo }` | `ADMIN` | `200` · `400` (otro campo, o deshabilitarse a sí mismo) · `401` · `403` · `404` |
| `GET /health` · `/api-docs` | Público | `200 { service, status: "ok" }` (no consulta la base) |

Reglas de validación: email con formato válido; password de **8 a 72 caracteres** (bcrypt ignora
lo que pasa de 72 bytes, así que se rechaza en lugar de truncarla). Las rutas de `/auth` responden
`503 { error, servicio }` si la base no está disponible.

El token lleva solo `sub` (id del usuario), `role`, `iss`, `iat` y `exp`, firmado con HS256.

## Seguridad

- La password nunca se guarda ni se devuelve: solo `passwordHash` (bcrypt, 12 rondas), y el
  `toJSON` del modelo es una lista blanca que no incluye el hash.
- El login compara contra un hash ficticio cuando el email no existe, para que el tiempo de
  respuesta no revele qué emails están registrados.
- Los logs registran `usuarioId`, `rol` y el motivo de un login fallido con el email enmascarado
  (`a***@ejemplo.com`). Nunca la password, el hash, el token ni `JWT_SECRET`. El log de cada request
  solo tiene método, URL, status y duración (no el body ni los headers).

## Estructura

```
src/
├── server.js        ← arranque: conecta a Mongo, crea las cuentas iniciales y abre el puerto
├── app.js           ← Express: rutas, Swagger y manejador de errores
├── config/          env.js (falla sin JWT_SECRET) · logger.js · db.js · swagger.js
├── models/          usuario.model.js
├── services/        usuarios.service.js (registro, login, altas) · tokens.js (firma)
│                    bootstrap.js (cuentas iniciales) · errores.js
├── controllers/     auth.controller.js · usuarios.controller.js
├── middlewares/     auth.js (copia del middleware de referencia de Inventario)
└── routes/          auth.routes.js · usuarios.routes.js · health.routes.js
```
