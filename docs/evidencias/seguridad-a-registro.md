# Evidencia · A — Registro válido

**Objetivo (TP7 §19, escenario A):** `POST /auth/register` con datos válidos crea el usuario y responde `201` sin `password` ni `passwordHash`.

Corrida del 28/10/2026 en Docker Compose (Linux, Docker 29.7, Compose 5.5), con los 11 contenedores
`healthy`. Rama local de integración que junta `feature/auth-service` (commit `80e8f09`),
`feature/catalogo-jwt` (`4cad6ce`) y `feature/compose-auth` (`29732f2`) de la Parte 1, y
`feature/inventario-jwt` (`7fa8af6`) y `feature/token-pruebas` (`2a1a124`) de la Parte 2. Ventas
todavía en su versión del TP6 (no interviene en estas pruebas).

Preparación, desde la raíz del repositorio:

```bash
cp .env.example .env     # JWT_SECRET generado con randomBytes(48) y passwords propias para ADMIN y Ventas
docker compose up --build -d
docker compose ps        # los 11 contenedores "healthy"
```

Los usuarios `cliente-a@tp7.local` y `quiere-ser-admin@tp7.local` son cuentas de laboratorio con
passwords de prueba; la del `ADMIN` sale del `.env` y no aparece en la evidencia. Ningún token se
muestra completo.

Comandos (`$ …`) y salida obtenida:

```text
$ curl -s -i -X POST http://localhost:3400/auth/register -H 'Content-Type: application/json' -d '{"email":"cliente-a@tp7.local","password":"Clave-de-prueba-A1"}'
HTTP/1.1 201 Created
X-Powered-By: Express
Content-Type: application/json; charset=utf-8
Content-Length: 132
ETag: W/"84-yGfyr4BqXLcEJ4bRC0wW+/6GHzw"
Date: Wed, 28 Oct 2026 23:25:26 GMT
Connection: keep-alive
Keep-Alive: timeout=5

{"id":"6ae28466a9973f47364822ab","email":"cliente-a@tp7.local","rol":"CLIENTE","activo":true,"createdAt":"2026-10-28T23:25:26.489Z"}
# Con "rol":"ADMIN" en el body: se ignora y el usuario queda CLIENTE (D11)
$ curl -s -w '\n%{http_code}\n' -X POST http://localhost:3400/auth/register -H 'Content-Type: application/json' -d '{"email":"quiere-ser-admin@tp7.local","password":"Clave-de-prueba-A2","rol":"ADMIN"}'
{"id":"6ae28466a9973f47364822ae","email":"quiere-ser-admin@tp7.local","rol":"CLIENTE","activo":true,"createdAt":"2026-10-28T23:25:26.999Z"}
201

# Datos inválidos
$ curl -s -w '\n%{http_code}\n' -X POST http://localhost:3400/auth/register -H 'Content-Type: application/json' -d '{"email":"no-es-un-email","password":"Clave-de-prueba-A1"}'
{"error":"El email es obligatorio y debe tener un formato válido","servicio":"auth-service"}
400

$ curl -s -w '\n%{http_code}\n' -X POST http://localhost:3400/auth/register -H 'Content-Type: application/json' -d '{"email":"corta@tp7.local","password":"1234567"}'
{"error":"La password es obligatoria y debe tener entre 8 y 72 caracteres","servicio":"auth-service"}
400
```

**Resultado:** ✅ `201` con `{ id, email, rol, activo, createdAt }`: la respuesta no tiene `password` ni `passwordHash`. El email se guarda normalizado y el rol es siempre `CLIENTE`, aunque el body pida `"rol":"ADMIN"` (D11). Con email o password inválidos, `400`.
