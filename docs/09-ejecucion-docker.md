# 9. Ejecución con Docker Compose: red, puertos y persistencia

> Corresponde a las secciones 11, 12 y 13 del TP6 (entregables 6 y 8). Parte 1 · Responsable:
> Josué Ferreyra. El archivo es [`compose.yml`](../compose.yml), en la raíz del repositorio.
> Las convenciones de nombres y puertos se congelaron en
> [`08-ratificacion-tp6.md`](./08-ratificacion-tp6.md#83-convenciones-de-ejecución) §8.3.

## 9.1 Qué levanta Compose

| Contenedor | Imagen | Rol | Depende de (por salud) |
|---|---|---|---|
| `catalogo-db` | `mongo:7` | Base de Catálogo | — |
| `inventario-db` | `mongo:7` | Bases de los 3 nodos de Inventario (`inventario_nodo1..3`, D2) | — |
| `ventas-db` | `mongo:7` | Base de Ventas | — |
| `redis` | `redis:7-alpine` | Lock interno de Inventario | — |
| `catalogo-service` | `grupo/catalogo:tp6` | Servicio de Catálogo | `catalogo-db` |
| `inventario-1`, `inventario-2`, `inventario-3` | `grupo/inventario:tp6` | Cluster Raft de Inventario | `inventario-db`, `redis` |
| `ventas-service` | `grupo/ventas:tp6` | Servicio de Ventas | `ventas-db` |

Todos están en una sola red, `backend`. Inventario y Ventas están comentados en
`compose.yml` hasta que las Partes 2 y 3 suban su Dockerfile; mientras tanto Compose levanta
Catálogo con las tres bases y Redis.

```bash
docker compose config        # valida la sintaxis y muestra las variables resueltas
docker compose up --build -d # construye las imágenes y levanta todo en segundo plano
docker compose ps            # todos tienen que llegar a "healthy"
docker compose logs -f       # logs de todos los servicios
docker compose down          # detiene y borra los contenedores (conserva los datos)
```

## 9.2 Red y nombres DNS (sección 12)

Dentro de la red `backend`, cada contenedor se llama por el **nombre de su servicio** en
Compose: Docker resuelve ese nombre a la IP del contenedor. Los 3 nodos de Inventario,
además, comparten el alias `inventario-service` (D1): quien llama a ese nombre llega a
cualquiera de los tres, y si el que responde es follower reenvía la escritura al Leader.

| Origen | Destino | URL correcta | Incorrecta, y por qué |
|---|---|---|---|
| PC | Catálogo | `http://localhost:3100` | — |
| PC | Nodo 2 de Inventario | `http://localhost:3202` | — |
| PC | Ventas | `http://localhost:3300` | — |
| Ventas | Catálogo | `http://catalogo-service:3100` | `http://localhost:3100`: dentro del contenedor, `localhost` es el propio contenedor |
| Ventas | Inventario | `http://inventario-service:3200` | `http://localhost:3201`: es el puerto publicado al host, no el interno; y apunta a un nodo fijo |
| Inventario | Catálogo (C4) | `http://catalogo-service:3100` | `http://127.0.0.1:3100`: mismo problema que `localhost` |
| Nodo de Inventario | Otro nodo (Raft) | `http://inventario-2:4200` | Publicar el 4200 al host "para que ande": el RPC de Raft no es parte de la API |
| Inventario | Redis | `redis://redis:6379` | `redis://127.0.0.1:6379`: es la URL del modo local (Memurai) |
| Catálogo | Su base | `mongodb://catalogo-db:27017/catalogo` | `mongodb://inventario-db:…`: ningún servicio usa la base de otro |

Ninguna de estas URLs está en el código: cada servicio las recibe por variables de entorno
(`CATALOGO_SERVICE_URL`, `INVENTARIO_SERVICE_URL`, `REDIS_URL`, `MONGODB_URI`), con un valor
para `npm start` (en su `.env.example`) y otro en `compose.yml`.

Prueba rápida del DNS interno, desde dentro de un contenedor:

```bash
docker compose exec catalogo-service node -e "fetch('http://catalogo-service:3100/health').then(r=>r.json()).then(console.log)"
# con Ventas e Inventario levantados:
docker compose exec ventas-service node -e "fetch('http://inventario-service:3200/health').then(r=>r.json()).then(console.log)"
```

## 9.3 Puertos internos vs publicados (sección 12.1)

El **puerto interno** es en el que escucha el proceso dentro de su contenedor; el
**publicado** es el que Docker abre en la PC (`"host:contenedor"` en `ports:`). Entre
contenedores siempre se usa el interno.

| Contenedor | Interno | Publicado al host | Por qué |
|---|---|---|---|
| `catalogo-service` | 3100 | 3100 | API pública |
| `inventario-1` / `-2` / `-3` | API 3200 · Raft 4200 | 3201 / 3202 / 3203 (solo la API) | Diagnóstico (`/api/cluster/estado`) y prueba de failover: hay que poder hablarle a un nodo puntual. Raft no se publica |
| `ventas-service` | 3300 | 3300 | API pública |
| `catalogo-db`, `inventario-db`, `ventas-db` | 27017 | no se publica | Solo la usa su servicio, por la red interna |
| `redis` | 6379 | no se publica | Detalle interno de Inventario |

No publicar las bases también evita choques con un MongoDB o un Redis/Memurai que ya esté
corriendo en la PC para el modo local.

## 9.4 Estrategia de inicio y disponibilidad (sección 14)

Que un contenedor esté "iniciado" no significa que esté listo. Por eso hay tres capas:

1. **Healthchecks.** Cada base responde a `db.adminCommand('ping')`, Redis a
   `redis-cli ping` y cada servicio a `GET /health` (con `node -e "fetch(…)"`, porque la
   imagen Alpine no trae `curl`). `docker compose ps` muestra `starting` → `healthy`.
2. **`depends_on` por salud.** Cada servicio espera a que **su propia base** esté `healthy`
   antes de arrancar (Inventario también espera a Redis). Ventas **no** depende de Catálogo
   ni de Inventario: si no están, responde `503` (ver
   [`12-comunicacion-y-fallos.md`](./12-comunicacion-y-fallos.md)). Así se puede probar el
   fallo de una dependencia sin que Compose impida arrancar.
3. **El servicio tolera que la base no esté.** `depends_on` es solo la primera protección:
   al arrancar, cada servicio reintenta la conexión a Mongo (10 intentos, cada 3 s); si la
   base se cae después, responde `503 { error, servicio }` sin colgarse ni reiniciarse, y
   vuelve a responder solo cuando la base vuelve. `GET /health` no consulta la base: indica
   que el proceso está vivo. Si los reintentos se agotan, el proceso termina y
   `restart: on-failure` lo vuelve a levantar.

## 9.5 Volúmenes y persistencia (sección 13)

| Volumen | Montado en | Contiene |
|---|---|---|
| `catalogo-data` | `catalogo-db:/data/db` | Productos |
| `inventario-data` | `inventario-db:/data/db` | Stock, descuentos, movimientos y log Raft de los 3 nodos |
| `ventas-data` | `ventas-db:/data/db` | Compras |

Compose les antepone el nombre del proyecto: en `docker volume ls` aparecen como
`proyecto-distribuido_catalogo-data`, etc.

| Comando | Contenedores | Volúmenes (datos) |
|---|---|---|
| `docker compose stop` | Se detienen, no se borran | Se conservan |
| `docker compose down` | Se borran | **Se conservan**: al volver a levantar, los datos siguen ahí |
| `docker compose down -v` | Se borran | **Se borran** `catalogo-data`, `inventario-data` y `ventas-data` |

`down -v` se usa **solo para reiniciar el laboratorio a propósito**, y después hay que
volver a cargar los datos de prueba (`node scripts/seed.js`, de la Parte 3). Antes de una
demo, usar `down` sin `-v`.

Redis no tiene volumen: el lock es temporal (tiene TTL) y perderlo al reiniciar no pierde
datos.

## 9.6 Ejecución local vs Compose

| Aspecto | `npm start` (local) | Docker Compose |
|---|---|---|
| Configuración | `.env` de cada servicio (copiado de `.env.example`) | `environment:` en `compose.yml`; el `.env` no entra a la imagen |
| URL de Catálogo | `http://localhost:3100` | `http://catalogo-service:3100` |
| URL de Inventario | `http://localhost:3201` (un nodo) | `http://inventario-service:3200` (alias de los 3) |
| MongoDB | Un servidor local, una base por servicio | Un contenedor por servicio |
| Redis | Memurai o Redis en `127.0.0.1:6379` | Contenedor `redis` |
| Logs | Una línea legible por consola | JSON por stdout (`docker compose logs`) |
| HTTPS | Solo en `app-base/` (D5) | No: HTTP dentro de la red `backend` |

El detalle de cada variable por entorno está en
[`11-configuracion-por-entorno.md`](./11-configuracion-por-entorno.md) (Parte 2).

> **Ojo con el `.env` de la raíz.** Compose lee automáticamente un archivo `.env` en la
> carpeta de `compose.yml` para resolver `${VARIABLE}`. Si ahí quedó el `.env` del TP4 de
> `app-base/`, sus valores pueden pisar los de Compose. El único que se lee es `LOG_LEVEL`
> (ver [`.env.example`](../.env.example)); `RAFT_COMMIT_TIMEOUT_MS` está fijo en 2500 (D3)
> justamente para que no lo cambie un `.env` viejo.
