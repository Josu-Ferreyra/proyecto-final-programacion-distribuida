# Persistencia con volúmenes

**Objetivo:** los datos sobreviven a `docker compose down` (sin `-v`) porque viven en
volúmenes con nombre.

```bash
curl -X POST http://localhost:3100/productos -H "Content-Type: application/json" \
  -d '{"nombre":"Prueba persistencia","precio":1000,"categoria":"otro"}'
curl "http://localhost:3100/productos?nombreContiene=persistencia"
docker compose down
docker volume ls --filter name=proyecto-distribuido
docker compose up -d
docker compose ps                     # esperar "healthy"
curl "http://localhost:3100/productos?nombreContiene=persistencia"
```

## Salida obtenida

Corrida del 2026-10-20 en un clon limpio de la rama `docs/tp6-deployment` (commit `79b2e3a`), antes del merge a `main`. Inventario y Ventas todavía no tienen Dockerfile, así que sus bloques de `compose.yml` están comentados y esta corrida cubre Catálogo, las tres bases y Redis. **Se repite sobre `main` con los tres servicios antes del tag `tp6-entrega`.**

```text
$ cd tp6-limpio

$ curl -s -X POST http://localhost:3100/productos -H "Content-Type: application/json" -d '{"nombre":"Prueba persistencia","precio":1000,"categoria":"otro"}'
{"id":"6ad7f3f6839082a71a468414","nombre":"Prueba persistencia","precio":1000,"categoria":"otro","activo":true,"createdAt":"2026-10-20T23:06:30.894Z","updatedAt":"2026-10-20T23:06:30.894Z"}
$ curl -s "http://localhost:3100/productos?nombreContiene=persistencia"
[{"id":"6ad7f3f6839082a71a468414","nombre":"Prueba persistencia","precio":1000,"categoria":"otro","activo":true,"createdAt":"2026-10-20T23:06:30.894Z","updatedAt":"2026-10-20T23:06:30.894Z"}]
$ docker compose down 2>&1 | grep -E 'Removed|Network'
 Container proyecto-distribuido-catalogo-service-1 Removed 
 Container proyecto-distribuido-ventas-db-1 Removed 
 Container proyecto-distribuido-redis-1 Removed 
 Container proyecto-distribuido-inventario-db-1 Removed 
 Container proyecto-distribuido-catalogo-db-1 Removed 
 Network proyecto-distribuido_backend Removing 
 Network proyecto-distribuido_backend Removed 

$ docker volume ls --filter name=proyecto-distribuido
DRIVER    VOLUME NAME
local     proyecto-distribuido_catalogo-data
local     proyecto-distribuido_inventario-data
local     proyecto-distribuido_ventas-data

$ docker compose up -d 2>&1 | grep -E 'Started|Healthy'
 Container proyecto-distribuido-ventas-db-1 Started 
 Container proyecto-distribuido-redis-1 Started 
 Container proyecto-distribuido-catalogo-db-1 Started 
 Container proyecto-distribuido-inventario-db-1 Started 
 Container proyecto-distribuido-catalogo-db-1 Healthy 
 Container proyecto-distribuido-catalogo-service-1 Started 

$ sleep 15

$ docker compose ps --format 'table {{.Service}}\t{{.Status}}'
SERVICE            STATUS
catalogo-db        Up 20 seconds (healthy)
catalogo-service   Up 15 seconds (healthy)
inventario-db      Up 20 seconds (healthy)
redis              Up 20 seconds (healthy)
ventas-db          Up 20 seconds (healthy)

$ curl -s "http://localhost:3100/productos?nombreContiene=persistencia"
[{"id":"6ad7f3f6839082a71a468414","nombre":"Prueba persistencia","precio":1000,"categoria":"otro","activo":true,"createdAt":"2026-10-20T23:06:30.894Z","updatedAt":"2026-10-20T23:06:30.894Z"}]
```

**Resultado:** ✅ el producto sigue con el mismo `id` después de `docker compose down` y `up`, porque `catalogo-data` no se borra.

**Resultado esperado:** el producto aparece antes y después del `down`/`up`, con el mismo
`id`, y `docker volume ls` muestra `proyecto-distribuido_catalogo-data`,
`proyecto-distribuido_inventario-data` y `proyecto-distribuido_ventas-data`.
