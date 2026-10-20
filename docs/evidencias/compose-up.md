# Inicio con Docker Compose

**Objetivo:** desde un clon limpio, un solo comando levanta todo y cada contenedor llega a
`healthy`.

```bash
git clone <repo> tp6-limpio && cd tp6-limpio
docker compose config --quiet && echo "compose.yml válido"
docker compose up --build -d
docker compose ps
```

## Salida obtenida

Corrida del 2026-10-20 en un clon limpio de la rama `docs/tp6-deployment` (commit `79b2e3a`), antes del merge a `main`. Inventario y Ventas todavía no tienen Dockerfile, así que sus bloques de `compose.yml` están comentados y esta corrida cubre Catálogo, las tres bases y Redis. **Se repite sobre `main` con los tres servicios antes del tag `tp6-entrega`.**

```text
$ cd tp6-limpio && git log --oneline -1
79b2e3a Actualizar el README para el TP6

$ docker compose config --quiet && echo "compose.yml válido"
compose.yml válido

$ docker compose up --build -d 2>&1 | grep -vE '^#|^ *[0-9a-f]{12}: |Pulling|Digest|Status' 
 Image grupo/catalogo:tp6 Building 

 Image grupo/catalogo:tp6 Built 
 Network proyecto-distribuido_backend Creating 
 Volume proyecto-distribuido_catalogo-data Creating 
 Volume proyecto-distribuido_inventario-data Creating 
 Network proyecto-distribuido_backend Creating 
 Volume proyecto-distribuido_inventario-data Creating 
 Volume proyecto-distribuido_catalogo-data Creating 
 Volume proyecto-distribuido_ventas-data Creating 
 Volume proyecto-distribuido_ventas-data Creating 
 Volume proyecto-distribuido_inventario-data Created 
 Volume proyecto-distribuido_inventario-data Created 
 Volume proyecto-distribuido_ventas-data Created 
 Volume proyecto-distribuido_ventas-data Created 
 Volume proyecto-distribuido_catalogo-data Created 
 Volume proyecto-distribuido_catalogo-data Created 
 Network proyecto-distribuido_backend Created 
 Network proyecto-distribuido_backend Created 
 Container proyecto-distribuido-ventas-db-1 Creating 
 Container proyecto-distribuido-redis-1 Creating 
 Container proyecto-distribuido-inventario-db-1 Creating 
 Container proyecto-distribuido-catalogo-db-1 Creating 
 Container proyecto-distribuido-inventario-db-1 Created 
 Container proyecto-distribuido-catalogo-db-1 Created 
 Container proyecto-distribuido-catalogo-service-1 Creating 
 Container proyecto-distribuido-ventas-db-1 Created 
 Container proyecto-distribuido-redis-1 Created 
 Container proyecto-distribuido-catalogo-service-1 Created 
 Container proyecto-distribuido-ventas-db-1 Starting 
 Container proyecto-distribuido-redis-1 Starting 
 Container proyecto-distribuido-catalogo-db-1 Starting 
 Container proyecto-distribuido-inventario-db-1 Starting 
 Container proyecto-distribuido-inventario-db-1 Started 
 Container proyecto-distribuido-redis-1 Started 
 Container proyecto-distribuido-ventas-db-1 Started 
 Container proyecto-distribuido-catalogo-db-1 Started 
 Container proyecto-distribuido-catalogo-db-1 Waiting 
 Container proyecto-distribuido-catalogo-db-1 Healthy 
 Container proyecto-distribuido-catalogo-service-1 Starting 
 Container proyecto-distribuido-catalogo-service-1 Started 

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

**Resultado:** ✅ un solo comando levanta todo; `catalogo-service` espera a que `catalogo-db` esté `healthy` (`Waiting` → `Healthy` → `Starting`) y a los 25 s todo está `healthy`. Solo se publica el 3100; las bases y Redis no.

**Resultado esperado:** en `docker compose ps`, las bases, Redis y los servicios en estado
`running (healthy)`, y solo los puertos 3100, 3201–3203 y 3300 publicados.
