# Evidencia · Catálogo protegido con tokens de `auth-service` (E, H, I en Catálogo)

**Objetivo (TP7 §19, escenarios E, H e I en Catálogo):** con un token real emitido por `auth-service`, un `ADMIN` modifica el catálogo, un `CLIENTE` recibe `403`, sin token `401`, y las consultas siguen públicas. El mismo token sirve en Inventario.

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

El token `ADMIN` se obtuvo con `POST /auth/login` en la [prueba extra](./seguridad-extra-cuenta-deshabilitada.md) y se guardó en `.token-admin` (archivo temporal, borrado al terminar).

Comandos (`$ …`) y salida obtenida:

```text
# Token emitido por auth-service usado en Catálogo e Inventario (validación local, D15)
$ ADMIN=$(cat .token-admin); curl -s -w '\n%{http_code}\n' -X POST http://localhost:3100/productos -H "Authorization: Bearer $ADMIN" -H 'Content-Type: application/json' -d '{"nombre":"Producto de integración TP7","precio":1500,"categoria":"otro"}'
{"id":"6ae2846f38bd234a819c7d2f","nombre":"Producto de integración TP7","precio":1500,"categoria":"otro","activo":true,"createdAt":"2026-10-28T23:25:35.565Z","updatedAt":"2026-10-28T23:25:35.565Z"}
201

$ CLIENTE=$(curl -s -X POST http://localhost:3400/auth/login -H 'Content-Type: application/json' -d '{"email":"cliente-a@tp7.local","password":"Clave-de-prueba-A1"}' | node -pe "JSON.parse(require(\"fs\").readFileSync(0)).accessToken"); curl -s -w '\n%{http_code}\n' -X POST http://localhost:3100/productos -H "Authorization: Bearer $CLIENTE" -H 'Content-Type: application/json' -d '{"nombre":"No debería crearse","precio":1}'
{"error":"Permisos insuficientes","servicio":"catalogo-service"}
403

$ curl -s -i -X POST http://localhost:3100/productos -H 'Content-Type: application/json' -d '{"nombre":"Sin token","precio":1}' | grep -iE '^HTTP|^www-auth|error'
HTTP/1.1 401 Unauthorized
WWW-Authenticate: Bearer
{"error":"Token ausente","servicio":"catalogo-service"}

$ curl -s -o /dev/null -w 'GET /productos sin token: %{http_code}\n' http://localhost:3100/productos
GET /productos sin token: 200

$ PID=$(curl -s 'http://localhost:3100/productos?nombreContiene=integraci' | node -pe 'JSON.parse(require("fs").readFileSync(0))[0].id'); curl -s -w '\n%{http_code}\n' -X PUT http://localhost:3201/stock/$PID -H "Authorization: Bearer $(cat .token-admin)" -H 'Content-Type: application/json' -d '{"cantidad":5}'
{"productoId":"6ae2846f38bd234a819c7d2f","stock":5}
200
```

**Resultado:** ✅ `POST /productos` con token `ADMIN` de `auth-service`: `201`. Con token `CLIENTE`: `403 "Permisos insuficientes"`. Sin token: `401 "Token ausente"` con `WWW-Authenticate: Bearer`. `GET /productos` sin token: `200` (C1 y C4 no llevan token, D13). El mismo token `ADMIN` sirve en `PUT /stock/:productoId` de Inventario (`200`), que a su vez consultó a Catálogo por C4 sin token. Catálogo e Inventario validaron el token localmente, sin llamar a `auth-service`.
