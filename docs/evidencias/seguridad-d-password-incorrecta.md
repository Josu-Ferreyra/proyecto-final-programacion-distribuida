# Evidencia · D — Password incorrecta

**Objetivo (TP7 §19, escenario D):** un login con password incorrecta responde `401 "Credenciales inválidas"`, exactamente igual que con un email que no existe.

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
# Password incorrecta de un usuario que existe
$ curl -s -w '\n%{http_code} en %{time_total} s\n' -X POST http://localhost:3400/auth/login -H 'Content-Type: application/json' -d '{"email":"cliente-a@tp7.local","password":"Password-incorrecta"}'
{"error":"Credenciales inválidas","servicio":"auth-service"}
401 en 0.489675 s

# Email que no existe
$ curl -s -w '\n%{http_code} en %{time_total} s\n' -X POST http://localhost:3400/auth/login -H 'Content-Type: application/json' -d '{"email":"nadie@tp7.local","password":"Password-incorrecta"}'
{"error":"Credenciales inválidas","servicio":"auth-service"}
401 en 0.483547 s

# Log de auth-service: el motivo real queda registrado, con el email enmascarado y sin la password
$ docker compose logs auth-service --no-log-prefix | grep 'Login fallido' | tail -2
{"email":"c***@tp7.local","level":"warn","message":"Login fallido","motivo":"password incorrecta","operacion":"login","servicio":"auth-service","timestamp":"2026-10-28T23:25:29.598Z"}
{"email":"n***@tp7.local","level":"warn","message":"Login fallido","motivo":"usuario inexistente","operacion":"login","servicio":"auth-service","timestamp":"2026-10-28T23:25:30.095Z"}
```

**Resultado:** ✅ Los dos casos responden `401 {"error":"Credenciales inválidas"}` y tardan lo mismo (0,49 s y 0,48 s), porque el login compara con bcrypt aunque el usuario no exista ([`15-identidad.md`](../15-identidad.md) §15.5). Desde afuera no se puede saber si el email está registrado. El motivo real solo queda en el log, con el email enmascarado y sin la password.
