# Health checks

**Objetivo:** cada servicio (y cada nodo de Inventario) responde `GET /health` sin exponer
secretos ni URIs.

```bash
curl http://localhost:3100/health    # catalogo-service
curl http://localhost:3201/health    # inventario-1
curl http://localhost:3202/health    # inventario-2
curl http://localhost:3203/health    # inventario-3
curl http://localhost:3300/health    # ventas-service
docker inspect --format '{{.Name}} {{.State.Health.Status}}' $(docker compose ps -q)
```

## Salida obtenida

Corrida del 2026-10-20 en un clon limpio de la rama `docs/tp6-deployment` (commit `79b2e3a`), antes del merge a `main`. Inventario y Ventas todavía no tienen Dockerfile, así que sus bloques de `compose.yml` están comentados y esta corrida cubre Catálogo, las tres bases y Redis. **Se repite sobre `main` con los tres servicios antes del tag `tp6-entrega`.**

```text
$ cd tp6-limpio

$ curl -s -i http://localhost:3100/health
HTTP/1.1 200 OK
X-Powered-By: Express
Content-Type: application/json; charset=utf-8
Content-Length: 44
ETag: W/"2c-bo34k7ITTDULSKlu1/XE9vE04Iw"
Date: Tue, 20 Oct 2026 23:06:30 GMT
Connection: keep-alive
Keep-Alive: timeout=5

{"service":"catalogo-service","status":"ok"}
$ docker inspect --format '{{.Name}} {{.State.Health.Status}}' $(docker compose ps -q)
/proyecto-distribuido-catalogo-db-1 healthy
/proyecto-distribuido-catalogo-service-1 healthy
/proyecto-distribuido-inventario-db-1 healthy
/proyecto-distribuido-redis-1 healthy
/proyecto-distribuido-ventas-db-1 healthy

$ docker compose exec catalogo-service node -e "fetch('http://catalogo-service:3100/health').then(r=>r.json()).then(console.log)"
{ service: 'catalogo-service', status: 'ok' }

$ docker compose exec catalogo-service node -e "require('dns').lookup('catalogo-db',(e,a)=>console.log('catalogo-db ->',a))"
catalogo-db -> 172.18.0.5
```

```text
$ cd tp6-limpio

$ docker compose exec catalogo-service node -e "require('dns').lookup('catalogo-db',(e,a)=>console.log('catalogo-db ->',a))"
catalogo-db -> 172.18.0.5

$ docker compose exec catalogo-service node -e "fetch('http://localhost:3100/health').then(r=>r.json()).then(console.log)"
{ service: 'catalogo-service', status: 'ok' }
```

**Resultado:** ✅ Catálogo responde `200 {"service":"catalogo-service","status":"ok"}` sin URIs ni secretos, todos los contenedores están `healthy` y el nombre `catalogo-db` se resuelve por el DNS interno de la red `backend`. Nodos de Inventario (3201–3203) y Ventas (3300): pendiente.

**Resultado esperado:** `200 {"service":"<nombre>","status":"ok"}` (los nodos de Inventario
agregan `"nodo"`), y `healthy` en todos los contenedores.
