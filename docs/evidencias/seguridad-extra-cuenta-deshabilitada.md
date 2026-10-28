# Evidencia · Extra — Cuenta deshabilitada (D12) y administración de usuarios

**Objetivo (TP7 §19):** un `ADMIN` puede deshabilitar una cuenta con `PATCH /auth/usuarios/:id`; esa cuenta ya no puede hacer login (`403`) y un `CLIENTE` no puede administrar usuarios (`403`).

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
# Login del ADMIN creado al arrancar (la password sale del .env y no se muestra)
$ ADMIN=$(curl -s -X POST http://localhost:3400/auth/login -H 'Content-Type: application/json' -d "{\"email\":\"admin@tp7.local\",\"password\":\"$ADMIN_PASSWORD\"}" | node -pe "JSON.parse(require(\"fs\").readFileSync(0)).accessToken"); echo "$ADMIN" > .token-admin; curl -s http://localhost:3400/auth/me -H "Authorization: Bearer $ADMIN"
{"id":"6ae28428a9973f47364822a4","email":"admin@tp7.local","rol":"ADMIN","activo":true}
# Un CLIENTE no puede administrar usuarios
$ CLIENTE=$(curl -s -X POST http://localhost:3400/auth/login -H 'Content-Type: application/json' -d '{"email":"cliente-a@tp7.local","password":"Clave-de-prueba-A1"}' | node -pe "JSON.parse(require(\"fs\").readFileSync(0)).accessToken"); curl -s -w '\n%{http_code}\n' -X POST http://localhost:3400/auth/usuarios -H "Authorization: Bearer $CLIENTE" -H 'Content-Type: application/json' -d '{"email":"x@tp7.local","password":"Clave-de-prueba-X1","rol":"ADMIN"}'
{"error":"Permisos insuficientes","servicio":"auth-service"}
403

# El ADMIN deshabilita la cuenta de quiere-ser-admin@tp7.local
$ ID=$(docker compose exec auth-db mongosh auth --quiet --eval 'db.usuarios.findOne({ email: "quiere-ser-admin@tp7.local" })._id.toString()'); curl -s -w '\n%{http_code}\n' -X PATCH http://localhost:3400/auth/usuarios/$ID -H "Authorization: Bearer $(cat .token-admin)" -H 'Content-Type: application/json' -d '{"activo":false}'
{"id":"6ae28466a9973f47364822ae","email":"quiere-ser-admin@tp7.local","rol":"CLIENTE","activo":false,"createdAt":"2026-10-28T23:25:26.999Z"}
200

# Login con la password correcta: 403. Con una incorrecta: el mismo 401 de siempre
$ curl -s -w '\n%{http_code}\n' -X POST http://localhost:3400/auth/login -H 'Content-Type: application/json' -d '{"email":"quiere-ser-admin@tp7.local","password":"Clave-de-prueba-A2"}'
{"error":"Cuenta deshabilitada","servicio":"auth-service"}
403

$ curl -s -w '\n%{http_code}\n' -X POST http://localhost:3400/auth/login -H 'Content-Type: application/json' -d '{"email":"quiere-ser-admin@tp7.local","password":"Password-incorrecta"}'
{"error":"Credenciales inválidas","servicio":"auth-service"}
401

$ docker compose logs auth-service --no-log-prefix | grep -E 'Cuenta deshabilitada|cuenta deshabilitada' | tail -2
{"level":"warn","message":"Login rechazado","motivo":"cuenta deshabilitada","operacion":"login","servicio":"auth-service","timestamp":"2026-10-28T23:25:35.156Z","usuarioId":"6ae28466a9973f47364822ae"}
{"error":"Cuenta deshabilitada","level":"warn","message":"Request rechazada","operacion":"POST /auth/login","servicio":"auth-service","status":403,"timestamp":"2026-10-28T23:25:35.156Z"}
```

**Resultado:** ✅ Un `CLIENTE` recibe `403 "Permisos insuficientes"` en `POST /auth/usuarios`. El `ADMIN` deshabilitó la cuenta (`activo: false`, queda en el log con su `adminId`). Con la password correcta el login responde `403 "Cuenta deshabilitada"`; con una incorrecta, el mismo `401` de siempre, así el `403` no sirve para adivinar passwords.
