# TP N°4 - Consenso distribuido con Raft (cluster de 3 nodos)

Continúa el [TP3](../Tp3) (API REST de `productos` con HTTPS, MongoDB/Mongoose, Winston,
Swagger y lock distribuido con Redis/Memurai). Ahora la misma aplicación corre como
**tres réplicas independientes** que se ponen de acuerdo con una implementación
educativa y simplificada de **Raft**: eligen un Leader por mayoría, replican las
escrituras en un log ordenado, las confirman (commit) cuando una mayoría las tiene y
recién ahí las aplican a la base MongoDB de cada nodo.

Las decisiones de diseño, las preguntas de control, los resultados de las pruebas y la
comparación con Paxos están en el informe
[`Informe_TP4_Vicente_Santiago.pdf`](./Informe_TP4_Vicente_Santiago.pdf). Las salidas
completas de las pruebas están en [`evidencia/`](./evidencia).

## Arquitectura en una imagen

```
                cliente (curl / Swagger / scripts)
                   │  HTTP 300x / HTTPS 344x  (API externa)
     ┌─────────────┼──────────────────┬──────────────────┐
     ▼             ▼                  ▼                  │
  nodo1          nodo2              nodo3                │ las escrituras solo las acepta
  API :3001      API :3002          API :3003            │ el Leader; un follower responde
  Raft :4001 ◄──► Raft :4002 ◄────► Raft :4003           │ 421 + quién es el Leader
     │   RequestVote / AppendEntries (HTTP interno)
     ▼             ▼                  ▼
  tp4_nodo1     tp4_nodo2          tp4_nodo3     ← una base Mongo por nodo
  productos     productos          productos       (negocio + raft_estado + raft_log)
  raft_estado   raft_estado        raft_estado
  raft_log      raft_log           raft_log

  Memurai/Redis: SOLO el lock de la compra (TP2). No participa de la elección, los
  votos, el quorum ni el commit.
```

Flujo de una escritura:

```
Cliente -> API del Leader -> validación -> comando (id y timestamps ya fijados)
        -> log Raft del Leader (LOCAL) -> AppendEntries a los followers (REPLICADA)
        -> mayoría 2/3 (COMMITTED) -> State Machine -> MongoDB local de cada nodo (APLICADA)
        -> respuesta al cliente con el resultado de aplicar la entrada
```

## Requisitos

- Node.js LTS (probado con 24.x) y npm
- MongoDB (Community Server local, o MongoDB Atlas)
- [Memurai Developer](https://www.memurai.com) (o Redis) corriendo en `127.0.0.1:6379`,
  solo para `POST /api/productos/:id/comprar`
- PowerShell (certificado HTTPS y scripts de laboratorio)

## Instalación

```bash
npm install
cp .env.example .env     # y completar (ver abajo)
```

Certificado HTTPS de desarrollo (igual que en el TP3):

```powershell
.\scripts\generar-certificado.ps1 -Password "unaClaveLocal"
```

Deja `certs/server.pfx` (no se entrega) y muestra `SSL_PFX_PATH`/`SSL_PASSPHRASE` para
copiar al `.env`. Si no hay certificado, cada nodo arranca igual pero solo con HTTP.

### MongoDB

Los tres nodos usan **el mismo servidor Mongo pero una base distinta cada uno**
(`tp4_nodo1`, `tp4_nodo2`, `tp4_nodo3`). El nombre de base se deriva del nodo, así que
la URI va sin base:

- Local: `MONGODB_URI=mongodb://127.0.0.1:27017`
- Atlas: `MONGODB_URI=mongodb+srv://<usuario>:<password>@<cluster>.mongodb.net/?retryWrites=true&w=majority`

Si con Atlas aparece `querySrv ETIMEOUT` al arrancar, es el DNS local que no resuelve
los registros SRV; se soluciona con `DNS_SERVERS=8.8.8.8,1.1.1.1` en el `.env`.

Para no instalar MongoDB como servicio se puede usar el binario del ZIP oficial:

```powershell
mongod.exe --dbpath C:\ruta\a\mongodata --port 27017 --bind_ip 127.0.0.1
```

### Variables de entorno (`.env`)

Son **comunes a los tres nodos**. Lo que distingue a cada nodo sale de `cluster.json`.

| Variable | Para qué es |
|---|---|
| `SSL_PFX_PATH` / `SSL_PASSPHRASE` | Certificado de la API externa HTTPS |
| `MONGODB_URI` | Servidor Mongo (sin nombre de base) |
| `MONGODB_DB_PREFIX` | Prefijo de las bases por nodo (`tp4_` → `tp4_nodo1`, ...) |
| `DNS_SERVERS` | Opcional: DNS a usar si el local no resuelve las URIs `mongodb+srv` |
| `REDIS_HOST` / `REDIS_PORT` / `REDIS_PASSWORD` | Memurai, solo para el lock de la compra |
| `LOCK_TTL_MS` | TTL del lock (10 s: tiene que cubrir lectura + delay + commit Raft) |
| `COMPRA_DELAY_MS` | Delay artificial dentro de la sección crítica de la compra |
| `RAFT_ELECTION_TIMEOUT_MIN_MS` / `_MAX_MS` | Rango del election timeout aleatorio (3000–6000 ms) |
| `RAFT_HEARTBEAT_MS` | Intervalo de heartbeats del Leader (1000 ms) |
| `RAFT_RPC_TIMEOUT_MS` | Timeout de cada RPC entre nodos (1500 ms) |
| `RAFT_COMMIT_TIMEOUT_MS` | Cuánto espera el Leader el commit antes de responder 503 (5000 ms) |
| `RAFT_MAX_ENTRADAS_POR_MENSAJE` | Tope de entradas por AppendEntries (50) |
| `LOG_DIR` / `LOG_LEVEL` / `LOG_MAX_SIZE` / `LOG_MAX_FILES` | Winston (cada nodo escribe en `LOG_DIR/<nodo>/`) |

### Configuración del cluster (`cluster.json`)

```json
{
  "host": "127.0.0.1",
  "nodos": {
    "nodo1": { "apiHttpPort": 3001, "apiHttpsPort": 3441, "raftPort": 4001 },
    "nodo2": { "apiHttpPort": 3002, "apiHttpsPort": 3442, "raftPort": 4002 },
    "nodo3": { "apiHttpPort": 3003, "apiHttpsPort": 3443, "raftPort": 4003 }
  }
}
```

## Ejecución de los tres nodos

Cada nodo es un proceso independiente del **mismo código**; solo cambia el argumento
`--node`. No hay que editar nada entre ejecuciones. En tres terminales:

```bash
npm run nodo1      # = node server.js --node nodo1
npm run nodo2
npm run nodo3
```

O, en Windows, una ventana por nodo:

```powershell
.\scripts\iniciar-cluster.ps1                 # los tres
.\scripts\iniciar-cluster.ps1 -Nodos nodo2    # solo uno (ej. para reincorporarlo)
```

A los pocos segundos (election timeout de 3–6 s) uno de los nodos queda como Leader.

| Nodo | API HTTP | API HTTPS | RPC Raft (interno) | Base |
|---|---|---|---|---|
| nodo1 | http://127.0.0.1:3001 | https://127.0.0.1:3441 | http://127.0.0.1:4001 | `tp4_nodo1` |
| nodo2 | http://127.0.0.1:3002 | https://127.0.0.1:3442 | http://127.0.0.1:4002 | `tp4_nodo2` |
| nodo3 | http://127.0.0.1:3003 | https://127.0.0.1:3443 | http://127.0.0.1:4003 | `tp4_nodo3` |

## Endpoints

**API de negocio** (puerto externo de cada nodo; Swagger en `/api-docs`):

| Método | Endpoint | Consenso | Status posibles |
|---|---|---|---|
| GET | /api/productos | No: lectura local del nodo | 200, 400 |
| GET | /api/productos/:id | No: lectura local del nodo | 200, 400, 404 |
| POST | /api/productos | Sí, solo en el Leader | 201, 400, 409, **421**, **503** |
| PUT | /api/productos/:id | Sí, solo en el Leader | 200, 400, 404, 409, **421**, **503** |
| DELETE | /api/productos/:id | Sí, solo en el Leader | 204, 400, 404, **421**, **503** |
| POST | /api/productos/:id/comprar | Lock Redis + Raft, solo en el Leader | 200, 400, 404, 409, **421**, **503** |

- **421 Misdirected Request**: el nodo es follower. No aplica nada y responde quién es
  el Leader (`leader.apiUrl`, `leader.reintentarEn` y header `X-Raft-Leader`).
- **503**: no hay Leader conocido (elección en curso), o la entrada no alcanzó mayoría
  en `RAFT_COMMIT_TIMEOUT_MS` (sin quorum: la operación no se aplicó).
- Las escrituras exitosas devuelven los headers `X-Raft-Index` y `X-Raft-Term` (la
  entrada del log que las confirmó). Todas las respuestas llevan `X-Raft-Nodo`.

**Diagnóstico** (solo lectura, también en la API externa):

| Método | Endpoint | Qué muestra |
|---|---|---|
| GET | /api/cluster/estado | nodo, rol, término, voto, Leader conocido, commitIndex, lastApplied, heartbeats, election timeout, nextIndex/matchIndex (en el Leader), base Mongo |
| GET | /api/cluster/log?desde=&hasta= | cada entrada con su estado: `LOCAL`, `REPLICADA`, `RECIBIDA`, `COMMITTED`, `APLICADA` |

**RPC internos de Raft** (puerto 400x, Swagger aparte en `/raft-docs`):
`POST /raft/request-vote`, `POST /raft/append-entries`, `GET /raft/estado`. Los usan los
nodos entre sí; **no son un mecanismo de prueba de negocio** (modifican término, voto y
log de quien los recibe). Ninguna de las pruebas de este TP los llama a mano.

## Scripts

| Comando | Qué hace |
|---|---|
| `npm run estado` | Tabla con el estado Raft de los tres nodos (y nextIndex/matchIndex del Leader) |
| `npm run estado -- --log` | Además, el log de cada nodo con el estado de cada entrada |
| `npm run comparar` | Lee **directo** las tres bases Mongo y dice si convergen |
| `npm run seed` | Carga 3 productos **a través del Leader** (pasan por Raft) |
| `npm run test:concurrencia -- <id>:<n> <id>:<n>` | Compras concurrentes contra el Leader; muestra stock y versión en los tres nodos |
| `npm run limpiar -- --si` | Borra las tres bases (con los nodos apagados) para empezar de cero |
| `.\scripts\detener-nodo.ps1 -Nodo nodoX` | Simula la caída (crash) de un nodo: mata su proceso |
| `.\scripts\pausar-nodo.ps1 -Nodo nodoX -Segundos 12` | Congela un nodo y lo reanuda (Leader viejo que vuelve) |
| `.\scripts\iniciar-cluster.ps1` | Una ventana de PowerShell por nodo |

## Secuencia de pruebas (escenarios A–I)

Con Mongo y Memurai levantados, partiendo de bases vacías (`npm run limpiar -- --si`).
Donde dice `<leader>`/`<follower>` usar lo que muestra `npm run estado`.

**A. Arranque**: levantar los tres nodos y ejecutar `npm run estado` → un LEADER y dos
FOLLOWER en el mismo término, cada uno con su base.

**B. Escritura sobre follower**:

```bash
curl -i -X POST http://127.0.0.1:<puerto-follower>/api/productos -H "Content-Type: application/json" -d "{\"nombre\":\"X\",\"precio\":1,\"stock\":1}"
```

→ `421` con el Leader; `npm run estado -- --log` muestra que no entró nada al log.

**C. CRUD sobre el Leader**: `POST`, `PUT`, `DELETE` contra el puerto del Leader, `npm run seed`
y `npm run comparar` → "CONVERGEN".

**D. Caída del Leader**: `.\scripts\detener-nodo.ps1 -Nodo <leader>`; en 3–6 s
`npm run estado` muestra un Leader nuevo con término mayor.

**E. Quorum 2/3**: con ese nodo caído, `POST`/`PUT` contra el Leader nuevo → `201`/`200`.

**G. Follower atrasado**: volver a levantar el nodo caído (`npm run nodoX`) →
adopta el término y Leader vigentes y recupera las entradas que se perdió;
`npm run comparar` → "CONVERGEN".

**F. Sin quorum 1/3**: detener los dos followers y hacer un `POST` al Leader → a los 5 s
responde `503`; `GET /api/cluster/log` muestra la entrada como `LOCAL` y el producto no
existe. (Al volver los otros nodos con otro Leader, esa entrada se descarta: ver
`evidencia/10-...`.)

**H. Restart completo**: `npm run estado -- --log`, detener los tres, volver a
levantarlos (sin limpiar) y repetir → el término no baja y el log y los productos
siguen ahí.

**I. Redis + Raft**: `npm run test:concurrencia -- <id>:6 <id>:6` sobre un producto con
stock 10 → una compra `200` (con su entrada Raft) y la otra `409` por lock; el stock final
es el mismo en los tres nodos.

## Logging

Cada nodo escribe en `logs/<nodo>/app-YYYY-MM-DD.log` y `error-YYYY-MM-DD.log` (JSON,
rotación diaria y por tamaño, igual que el TP3) y por consola con el prefijo `[nodoX]`.
Se registran: cambio de término, elección (timeout, votos pedidos/concedidos/denegados),
cambio de rol, Leader reconocido, replicación (AppendEntries con entradas, confirmaciones,
rechazos por inconsistencia y retroceso de `nextIndex`), commit, aplicación a la State
Machine, peers caídos/recuperados, recuperación del estado al arrancar, lock
adquirido/liberado. Los heartbeats individuales van en nivel `debug`
(`LOG_LEVEL=debug`) para no inundar el log; sus contadores están en `/api/cluster/estado`.

## Estructura del proyecto

```
server.js                               -> arranque de UN nodo (--node nodoX)
cluster.json                            -> configuración común del cluster (puertos por nodo)
src/config/cluster.js                   -> identidad del nodo: puertos, base, peers
src/config/db.js                        -> conexión a Mongo con la base del nodo
src/raft/raftNode.js                    -> protocolo: roles, elección, heartbeats, log, commit
src/raft/stateMachine.js                -> aplica entradas committed a la colección productos
src/raft/storage.js                     -> persistencia Raft (raft_estado, raft_log)
src/raft/raftApp.js                     -> servidor HTTP interno (RPC) + Swagger interno
src/raft/rpcClient.js                   -> cliente HTTP de RequestVote / AppendEntries
src/raft/mutex.js                       -> serializa las secciones que tocan el estado Raft
src/raft/instancia.js                   -> referencia al RaftNode del proceso
src/middlewares/soloLeader.js           -> 421 en followers, 503 sin Leader/sin quorum
src/controllers/productos.controller.js -> validación + comando + propuesta a Raft
src/routes/productos.routes.js          -> rutas de negocio + anotaciones OpenAPI
src/routes/cluster.routes.js            -> diagnóstico: /api/cluster/estado y /log
src/models/producto.model.js            -> Schema (con version y ultimoIndiceRaft)
src/lib/logger.js                       -> Winston por nodo
src/lib/lock.js, redisClient.js         -> lock distribuido del TP2
src/docs/swagger.js                     -> spec OpenAPI de la API externa
scripts/                                -> ver tabla de scripts
evidencia/                              -> salidas de las pruebas A–I e hitos
```
