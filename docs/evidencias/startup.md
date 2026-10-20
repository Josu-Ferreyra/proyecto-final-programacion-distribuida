# Startup y disponibilidad

**Objetivo:** los servicios esperan a su base (healthchecks y `depends_on` por salud) y
toleran que la base se caiga después: responden `503` sin colgarse ni reiniciarse, y vuelven
a funcionar solos cuando la base vuelve.

```bash
docker compose down
docker compose up -d
docker compose ps                     # mostrar "starting" → "healthy"

docker compose stop catalogo-db
curl -i http://localhost:3100/productos           # 503 inmediato
curl -i http://localhost:3100/health              # 200: el proceso sigue vivo
docker compose ps catalogo-service                # sigue "Up", sin reinicios
docker compose start catalogo-db
sleep 15
curl -i http://localhost:3100/productos           # 200 sin reiniciar el servicio
docker compose logs catalogo-service | grep -i mongodb
```

## Salida obtenida

Corrida del 2026-10-20 en un clon limpio de la rama `docs/tp6-deployment` (commit `79b2e3a`), antes del merge a `main`. Inventario y Ventas todavía no tienen Dockerfile, así que sus bloques de `compose.yml` están comentados y esta corrida cubre Catálogo, las tres bases y Redis. **Se repite sobre `main` con los tres servicios antes del tag `tp6-entrega`.**

Arranque (de `docker compose up --build -d`): `starting` → `healthy`.

```text
$ docker compose ps --format 'table {{.Service}}\t{{.Status}}\t{{.Ports}}'
SERVICE            STATUS                                     PORTS
catalogo-db        Up 6 seconds (healthy)                     27017/tcp
catalogo-service   Up Less than a second (health: starting)   0.0.0.0:3100->3100/tcp, [::]:3100->3100/tcp
inventario-db      Up 6 seconds (healthy)                     27017/tcp
redis              Up 6 seconds (health: starting)            6379/tcp
ventas-db          Up 6 seconds (healthy)                     27017/tcp
$ sleep 25
$ docker compose ps --format 'table {{.Service}}\t{{.Status}}\t{{.Ports}}'
SERVICE            STATUS                    PORTS
catalogo-db        Up 31 seconds (healthy)   27017/tcp
catalogo-service   Up 25 seconds (healthy)   0.0.0.0:3100->3100/tcp, [::]:3100->3100/tcp
inventario-db      Up 31 seconds (healthy)   27017/tcp
redis              Up 31 seconds (healthy)   6379/tcp
ventas-db          Up 31 seconds (healthy)   27017/tcp
```

Base detenida y recuperada sin reiniciar el servicio:

```text
$ cd tp6-limpio

$ docker compose stop catalogo-db 2>&1 | grep Stopped
 Container proyecto-distribuido-catalogo-db-1 Stopped 

$ curl -s -i -w '\ntiempo: %{time_total}s\n' http://localhost:3100/productos | grep -E '^HTTP|^\{|tiempo'
HTTP/1.1 503 Service Unavailable
{"error":"Base de datos no disponible","servicio":"catalogo-service"}
tiempo: 0.001459s

$ curl -s -w '  (%{http_code})\n' http://localhost:3100/health
{"service":"catalogo-service","status":"ok"}  (200)

$ sleep 12

$ docker compose ps catalogo-service --format 'table {{.Service}}\t{{.Status}}'
SERVICE            STATUS
catalogo-service   Up 27 seconds (healthy)

$ docker inspect --format 'Reinicios: {{.RestartCount}}' $(docker compose ps -q catalogo-service)
Reinicios: 0

$ docker compose start catalogo-db 2>&1 | grep -E 'Started|Healthy'
 Container proyecto-distribuido-catalogo-db-1 Started 

$ sleep 20

$ curl -s -w '  (%{http_code})\n' "http://localhost:3100/productos?nombreContiene=persistencia"
[{"id":"6ad7f3f6839082a71a468414","nombre":"Prueba persistencia","precio":1000,"categoria":"otro","activo":true,"createdAt":"2026-10-20T23:06:30.894Z","updatedAt":"2026-10-20T23:06:30.894Z"}]  (200)

$ docker inspect --format 'Reinicios: {{.RestartCount}}' $(docker compose ps -q catalogo-service)
Reinicios: 0

$ docker compose logs --no-log-prefix catalogo-service | grep -E 'MongoDB|503|no disponible' | tail -4
{"level":"warn","message":"Conexión a MongoDB perdida","operacion":"db.connection","servicio":"catalogo-service","timestamp":"2026-10-20T23:06:53.073Z"}
{"error":"Base de datos no disponible","level":"warn","message":"Request rechazada","operacion":"GET /productos","servicio":"catalogo-service","status":503,"timestamp":"2026-10-20T23:06:53.238Z"}
{"level":"info","message":"Request","method":"GET","ms":0,"servicio":"catalogo-service","status":503,"timestamp":"2026-10-20T23:06:53.239Z","url":"/productos"}
{"level":"info","message":"Conexión a MongoDB recuperada","operacion":"db.connection","servicio":"catalogo-service","timestamp":"2026-10-20T23:07:18.089Z"}
```

**Resultado:** ✅ con `catalogo-db` detenida, `GET /productos` responde `503` en ~1 ms (no se cuelga), `/health` sigue en `200`, el contenedor sigue `healthy` con 0 reinicios, y al volver la base responde `200` sin reiniciar el servicio.

**Resultado esperado:** `503 {"error":"Base de datos no disponible","servicio":"catalogo-service"}`
mientras la base está detenida; en los logs, `Conexión a MongoDB perdida` y después
`Conexión a MongoDB recuperada`.
