# Evidencia · K — Reinicio con Compose

**Objetivo (TP7 §19, escenario K):** después de `docker compose down` (sin `-v`) y `up -d`, los usuarios siguen existiendo y el login vuelve a funcionar.

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

Se corrió después de las pruebas A–D, L y la de [cuenta deshabilitada](./seguridad-extra-cuenta-deshabilitada.md).

Comandos (`$ …`) y salida obtenida:

```text
$ docker compose down
 Container proyecto-distribuido-auth-service-1 Stopping 
 Container proyecto-distribuido-inventario-1-1 Stopping 
 Container proyecto-distribuido-inventario-3-1 Stopping 
 Container proyecto-distribuido-catalogo-service-1 Stopping 
 Container proyecto-distribuido-inventario-2-1 Stopping 
 Container proyecto-distribuido-ventas-service-1 Stopping 
 Container proyecto-distribuido-catalogo-service-1 Stopped 
 Container proyecto-distribuido-catalogo-service-1 Removing 
 Container proyecto-distribuido-catalogo-service-1 Removed 
 Container proyecto-distribuido-catalogo-db-1 Stopping 
 Container proyecto-distribuido-ventas-service-1 Stopped 
 Container proyecto-distribuido-ventas-service-1 Removing 
 Container proyecto-distribuido-auth-service-1 Stopped 
 Container proyecto-distribuido-auth-service-1 Removing 
 Container proyecto-distribuido-ventas-service-1 Removed 
 Container proyecto-distribuido-ventas-db-1 Stopping 
 Container proyecto-distribuido-auth-service-1 Removed 
 Container proyecto-distribuido-auth-db-1 Stopping 
 Container proyecto-distribuido-inventario-1-1 Stopped 
 Container proyecto-distribuido-inventario-1-1 Removing 
 Container proyecto-distribuido-inventario-3-1 Stopped 
 Container proyecto-distribuido-inventario-3-1 Removing 
 Container proyecto-distribuido-inventario-1-1 Removed 
 Container proyecto-distribuido-inventario-3-1 Removed 
 Container proyecto-distribuido-inventario-2-1 Stopped 
 Container proyecto-distribuido-inventario-2-1 Removing 
 Container proyecto-distribuido-inventario-2-1 Removed 
 Container proyecto-distribuido-inventario-db-1 Stopping 
 Container proyecto-distribuido-redis-1 Stopping 
 Container proyecto-distribuido-catalogo-db-1 Stopped 
 Container proyecto-distribuido-catalogo-db-1 Removing 
 Container proyecto-distribuido-catalogo-db-1 Removed 
 Container proyecto-distribuido-ventas-db-1 Stopped 
 Container proyecto-distribuido-ventas-db-1 Removing 
 Container proyecto-distribuido-auth-db-1 Stopped 
 Container proyecto-distribuido-auth-db-1 Removing 
 Container proyecto-distribuido-ventas-db-1 Removed 
 Container proyecto-distribuido-auth-db-1 Removed 
 Container proyecto-distribuido-redis-1 Stopped 
 Container proyecto-distribuido-redis-1 Removing 
 Container proyecto-distribuido-inventario-db-1 Stopped 
 Container proyecto-distribuido-inventario-db-1 Removing 
 Container proyecto-distribuido-redis-1 Removed 
 Container proyecto-distribuido-inventario-db-1 Removed 
 Network proyecto-distribuido_backend Removing 
 Network proyecto-distribuido_backend Removed 

$ docker volume ls --filter name=proyecto-distribuido_auth-data --format '{{.Name}}'
proyecto-distribuido_auth-data

$ docker compose up -d 2>&1 | grep -E 'auth' 
 Container proyecto-distribuido-auth-db-1 Creating 
 Container proyecto-distribuido-auth-db-1 Created 
 Container proyecto-distribuido-auth-service-1 Creating 
 Container proyecto-distribuido-auth-service-1 Created 
 Container proyecto-distribuido-auth-db-1 Starting 
 Container proyecto-distribuido-auth-db-1 Started 
 Container proyecto-distribuido-auth-db-1 Waiting 
 Container proyecto-distribuido-auth-db-1 Healthy 
 Container proyecto-distribuido-auth-service-1 Starting 
 Container proyecto-distribuido-auth-service-1 Started 

$ docker compose ps --format 'table {{.Name}}\t{{.Status}}'
NAME                                      STATUS
proyecto-distribuido-auth-db-1            Up 16 seconds (healthy)
proyecto-distribuido-auth-service-1       Up 10 seconds (healthy)
proyecto-distribuido-catalogo-db-1        Up 16 seconds (healthy)
proyecto-distribuido-catalogo-service-1   Up 10 seconds (healthy)
proyecto-distribuido-inventario-1-1       Up 5 seconds (healthy)
proyecto-distribuido-inventario-2-1       Up 5 seconds (healthy)
proyecto-distribuido-inventario-3-1       Up 5 seconds (healthy)
proyecto-distribuido-inventario-db-1      Up 16 seconds (healthy)
proyecto-distribuido-redis-1              Up 16 seconds (healthy)
proyecto-distribuido-ventas-db-1          Up 16 seconds (healthy)
proyecto-distribuido-ventas-service-1     Up 10 seconds (healthy)

$ docker compose logs auth-service --no-log-prefix | grep -E 'Cuenta|escuchando'
{"level":"info","message":"Cuenta ADMIN ya existente: no se modifica","operacion":"bootstrap","rol":"ADMIN","servicio":"auth-service","timestamp":"2026-10-28T23:25:58.885Z","usuarioId":"6ae28428a9973f47364822a4"}
{"level":"info","message":"Cuenta SERVICIO ya existente: no se modifica","operacion":"bootstrap","rol":"SERVICIO","servicio":"auth-service","timestamp":"2026-10-28T23:25:58.888Z","usuarioId":"6ae28428a9973f47364822a8"}
{"level":"info","message":"API escuchando en el puerto 3400 (docs: /api-docs)","operacion":"arranque","servicio":"auth-service","timestamp":"2026-10-28T23:25:58.899Z"}

$ curl -s -w '\n%{http_code}\n' -X POST http://localhost:3400/auth/login -H 'Content-Type: application/json' -d '{"email":"cliente-a@tp7.local","password":"Clave-de-prueba-A1"}' | node -e 'const [b,s]=require("fs").readFileSync(0,"utf8").trim().split("\n"); const r=JSON.parse(b); console.log(s, { tokenType: r.tokenType, expiresIn: r.expiresIn, accessToken: r.accessToken ? "(presente, no se muestra)" : r })'
200 {
  tokenType: 'Bearer',
  expiresIn: 900,
  accessToken: '(presente, no se muestra)'
}

$ curl -s -w '\n%{http_code}\n' -X POST http://localhost:3400/auth/register -H 'Content-Type: application/json' -d '{"email":"cliente-a@tp7.local","password":"Clave-de-prueba-A1"}'
{"error":"El email ya está registrado","servicio":"auth-service"}
409

$ docker compose exec auth-db mongosh auth --quiet --eval 'db.usuarios.countDocuments()'
4
```

**Resultado:** ✅ `docker compose down` borró los contenedores pero no el volumen `auth-data`. Al volver a levantar, los 11 contenedores llegaron a `healthy`, el bootstrap encontró las cuentas `ADMIN` y `SERVICIO` y no las tocó (es idempotente, D11), el login del usuario de la prueba A respondió `200` y su email sigue registrado (`409`). Los 4 usuarios persisten.
