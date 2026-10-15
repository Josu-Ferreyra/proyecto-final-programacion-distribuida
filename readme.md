# TP4 – API REST Distribuida + Raft

## Programación Distribuida

Proyecto desarrollado como evolución de los trabajos prácticos anteriores.

El objetivo de esta etapa es incorporar conceptos de **consenso distribuido** mediante una implementación simplificada del algoritmo **Raft**, manteniendo e integrando las funcionalidades desarrolladas previamente:

- API REST con Node.js y Express.
- HTTPS.
- Persistencia con MongoDB y Mongoose.
- Logging con Winston.
- Documentación OpenAPI / Swagger.
- Redis / Memurai para exclusión mutua distribuida.
- Ejecución de múltiples nodos independientes.
- Elección automática de Leader.
- Replicación de log.
- Commit por quorum.
- State Machine replicada.
- Persistencia del estado Raft.
- Recuperación de followers atrasados.
- Integración del CRUD REST con Raft.

> Redis/Memurai **no participa en la elección de Leader, votación, quorum, replicación ni commit de Raft**. Su función en este proyecto es resolver exclusión mutua para operaciones concurrentes.

---

## 1. Tecnologías utilizadas

- Node.js
- npm
- Express
- MongoDB
- Mongoose
- Redis / Memurai
- Winston
- Swagger / OpenAPI 3
- `swagger-ui-express`
- `cors`
- HTTPS mediante certificado PFX
- API `fetch` nativa de Node.js

---

## 2. Arquitectura general

El sistema ejecuta **tres instancias independientes de la misma aplicación**.

Cada nodo posee:

- una API REST HTTP;
- una API REST HTTPS;
- un servidor HTTP interno para Raft;
- una base MongoDB propia;
- un estado Raft propio;
- un election timer propio;
- un log Raft;
- persistencia local del estado Raft;
- logs de aplicación independientes.

```text
                           CLIENTE
                              │
                        API REST / HTTPS
                              │
              ┌───────────────┼───────────────┐
              │               │               │
            node1           node2           node3
              │               │               │
         API 3000        API 3001        API 3002
       HTTPS 3443      HTTPS 3444      HTTPS 3445
              │               │               │
         Raft 4001       Raft 4002       Raft 4003
              │               │               │
              └────── comunicación Raft ──────┘
```

Las escrituras del negocio son aceptadas únicamente por el **Leader**.

El Leader:

1. crea el comando;
2. lo agrega a su log;
3. lo replica mediante `AppendEntries`;
4. espera quorum;
5. avanza `commitIndex`;
6. aplica las entradas committed en la State Machine;
7. responde al cliente.

---

## 3. Nodos, puertos y bases de datos

| Nodo | HTTP API | HTTPS API | Raft interno | MongoDB |
|---|---:|---:|---:|---|
| node1 | 3000 | 3443 | 4001 | `tp4_node1` |
| node2 | 3001 | 3444 | 4002 | `tp4_node2` |
| node3 | 3002 | 3445 | 4003 | `tp4_node3` |

Swagger:

| Nodo | URL |
|---|---|
| node1 | `http://127.0.0.1:3000/api-docs` |
| node2 | `http://127.0.0.1:3001/api-docs` |
| node3 | `http://127.0.0.1:3002/api-docs` |

La API externa utiliza `/api` como prefijo.

Ejemplo:

```text
http://127.0.0.1:3000/api/productos
```

Los RPC internos de Raft no utilizan `/api`.

Ejemplo:

```text
http://127.0.0.1:4001/raft/status
```

---

## 4. Estructura principal del proyecto

```text
TP_4/
│
├── src/
│   ├── models/
│   │   ├── product.js
│   │   └── raftPersistentState.js
│   │
│   ├── raft/
│   │   ├── cluster.js
│   │   ├── commandClient.js
│   │   ├── election.js
│   │   ├── heartbeat.js
│   │   ├── raftPersistence.js
│   │   ├── raftRoutes.js
│   │   ├── raftState.js
│   │   ├── raftSwagger.js
│   │   ├── replication.js
│   │   ├── requestVote.js
│   │   └── stateMachine.js
│   │
│   ├── database.js
│   ├── endpoints.js
│   ├── logger.js
│   ├── redis.js
│   ├── service.js
│   └── swagger.js
│
├── logs/
│   ├── node1/
│   ├── node2/
│   └── node3/
│
├── .env
├── .env.example
├── .gitignore
├── package.json
├── package-lock.json
└── README.md
```

---

## 5. Instalación

Desde la carpeta raíz:

```cmd
npm.cmd install
```

No debe distribuirse la carpeta:

```text
node_modules/
```

---

## 6. Variables de entorno

Crear `.env` a partir de `.env.example`.

Ejemplo:

```env
NODE_ENV=development

HOST=127.0.0.1
API_PREFIX=/api
JSON_LIMIT=100kb

HTTP_ENABLED=true
HTTP_PORT=3000

HTTPS_ENABLED=true
HTTPS_PORT=3443
HTTPS_PFX_PATH=./certs/server.pfx
HTTPS_PFX_PASSPHRASE=CAMBIAR_LOCALMENTE

MONGODB_BASE_URI=mongodb://127.0.0.1:27017
MONGODB_DB_PREFIX=tp4

REDIS_URL=redis://127.0.0.1:6379

LOG_LEVEL=info
LOG_DIR=./logs
LOG_MAX_SIZE=5m
LOG_MAX_FILES=7d

RAFT_ELECTION_TIMEOUT_MIN_MS=2500
RAFT_ELECTION_TIMEOUT_MAX_MS=4500
RAFT_RPC_TIMEOUT_MS=1500
RAFT_HEARTBEAT_INTERVAL_MS=700
RAFT_REPLICATION_RPC_TIMEOUT_MS=700
```

> `.env` no debe entregarse ni versionarse. Se distribuye únicamente `.env.example`.

---

## 7. Servicios requeridos

Antes de iniciar los nodos deben estar disponibles:

### MongoDB

```text
mongodb://127.0.0.1:27017
```

Cada nodo selecciona su propia base:

```text
tp4_node1
tp4_node2
tp4_node3
```

### Redis / Memurai

```text
redis://127.0.0.1:6379
```

Puede verificarse con:

```cmd
redis-cli ping
```

Respuesta esperada:

```text
PONG
```

---

## 8. Ejecución del cluster

Abrir tres terminales independientes.

### Terminal 1

```cmd
npm.cmd run node1
```

### Terminal 2

```cmd
npm.cmd run node2
```

### Terminal 3

```cmd
npm.cmd run node3
```

En una instalación nueva, un nodo parte como `FOLLOWER` y sin Leader conocido.

En reinicios posteriores, el nodo restaura desde MongoDB su estado persistente:

- `currentTerm`
- `votedFor`
- `log`
- `commitIndex`
- `lastApplied`

El `role`, `leaderId`, `nextIndex` y `matchIndex` son estado volátil y se reconstruyen durante la ejecución.

---

## 9. Roles Raft

Un nodo puede estar en uno de estos estados:

```text
FOLLOWER
CANDIDATE
LEADER
```

Todos los nodos comienzan o reinician operativamente como `FOLLOWER`.

Si un follower no recibe actividad válida del Leader antes de vencer su election timeout:

```text
FOLLOWER
   │
   │ timeout
   ▼
CANDIDATE
   │
   │ quorum
   ▼
LEADER
```

---

## 10. Election Timeout

Cada follower utiliza un timeout aleatorio entre:

```text
RAFT_ELECTION_TIMEOUT_MIN_MS
RAFT_ELECTION_TIMEOUT_MAX_MS
```

Con la configuración de ejemplo:

```text
2500 ms a 4500 ms
```

Cuando vence:

1. el nodo incrementa `currentTerm`;
2. pasa a `CANDIDATE`;
3. se vota a sí mismo;
4. persiste el nuevo término y voto;
5. envía `RequestVote` a sus peers.

---

## 11. RequestVote

RPC interno:

```http
POST /raft/request-vote
```

Ejemplo conceptual:

```json
{
  "term": 13,
  "candidateId": "node2",
  "lastLogIndex": 7,
  "lastLogTerm": 11
}
```

El receptor verifica:

- término del candidato;
- voto emitido en ese término;
- identidad del candidato;
- actualidad del log del candidato.

Un nodo no debe votar por dos candidatos distintos dentro del mismo término.

`currentTerm` y `votedFor` se persisten para mantener esta propiedad incluso después de un reinicio.

---

## 12. Quorum

El quorum se calcula como:

```text
floor(clusterSize / 2) + 1
```

Para tres nodos:

```text
quorum = 2
```

Por lo tanto:

```text
3 nodos disponibles → puede existir quorum
2 nodos disponibles → puede existir quorum
1 nodo disponible   → no puede confirmar nuevas escrituras
```

Un nodo aislado no puede confirmar entradas nuevas por sí solo.

---

## 13. Heartbeats y AppendEntries

RPC interno:

```http
POST /raft/append-entries
```

`AppendEntries` cumple dos funciones.

### Heartbeat

```json
{
  "entries": []
}
```

Un array vacío permite al Leader mantener estable el liderazgo.

### Replicación

```json
{
  "entries": [
    {
      "index": 8,
      "term": 16,
      "command": {
        "type": "PRODUCT_CREATE",
        "payload": {}
      }
    }
  ]
}
```

Cuando existen entradas nuevas, el mismo RPC replica el log.

También transporta `leaderCommit` para que los followers puedan avanzar su propio `commitIndex` y aplicar entradas committed.

---

## 14. Replicated Log

Cada entrada posee:

```text
index
term
command
```

Los comandos implementados son:

```text
PRODUCT_CREATE
PRODUCT_UPDATE
PRODUCT_DELETE
PRODUCT_RESERVE
```

---

## 15. nextIndex y matchIndex

El Leader mantiene para cada follower:

```text
nextIndex
matchIndex
```

`nextIndex` indica qué entrada debe intentar enviar a continuación.

`matchIndex` indica la última entrada confirmada como replicada en ese follower.

Si un follower rechaza `AppendEntries` porque no posee `prevLogIndex` o el término no coincide, el Leader retrocede `nextIndex` y vuelve a intentar.

Este mecanismo permite recuperar followers atrasados.

---

## 16. Commit

Una entrada se considera committed cuando el Leader comprueba que fue replicada en una mayoría del cluster.

Para tres nodos:

```text
Leader + 1 follower = quorum
```

Después del quorum:

```text
commitIndex avanza
```

y la State Machine puede aplicar la entrada.

Raft no utiliza Redis para decidir commit.

---

## 17. State Machine

Las entradas committed se aplican estrictamente en orden desde `lastApplied + 1` hasta alcanzar `commitIndex`.

La State Machine actual soporta:

```text
PRODUCT_CREATE
PRODUCT_UPDATE
PRODUCT_DELETE
PRODUCT_RESERVE
```

El valor `lastApplied` sólo avanza después de procesar la entrada correspondiente.

Los errores funcionales determinísticos, por ejemplo un recurso que ya fue eliminado, no deben bloquear indefinidamente la aplicación de entradas posteriores.

---

## 18. Persistencia del estado Raft

Cada nodo persiste su estado Raft en su propia base MongoDB, colección:

```text
raftstates
```

Se persisten:

```text
nodeId
currentTerm
votedFor
log
commitIndex
lastApplied
```

No se persisten:

```text
role
leaderId
nextIndex
matchIndex
election timers
```

porque son estado volátil.

La persistencia se actualiza en eventos críticos como:

```text
BECOME_CANDIDATE
VOTE_GRANTED
REQUEST_VOTE_HIGHER_TERM
APPEND_ENTRIES_HIGHER_TERM
LEADER_APPEND_LOCAL_ENTRY
FOLLOWER_APPEND_ENTRIES
LEADER_COMMIT_ADVANCED
FOLLOWER_COMMIT_ADVANCED
STATE_MACHINE_APPLIED
SHUTDOWN
```

Esto permite detener completamente el cluster y conservar el término, votos, log y progreso aplicado.

---

## 19. Recuperación después de reinicio

Al iniciar un nodo:

```text
MongoDB
   │
   ▼
loadPersistentRaftState()
   │
   ▼
initRaftState()
   │
   ▼
FOLLOWER
```

Si el estado persistido indica:

```text
commitIndex > lastApplied
```

el nodo aplica las entradas pendientes antes de continuar normalmente.

Una nueva elección puede incrementar el término después del reinicio. Esto es esperado.

El log committed permanece intacto.

---

## 20. Failover del Leader

Si el Leader deja de enviar heartbeats:

```text
Followers
   │
   │ election timeout
   ▼
nueva elección
   │
   ▼
nuevo Leader
```

Las escrituras continúan siendo posibles mientras existan al menos dos nodos disponibles.

Con un solo nodo no existe quorum para confirmar comandos nuevos.

---

## 21. Recuperación de un follower atrasado

Un follower puede detenerse mientras el Leader continúa trabajando con el tercer nodo.

Ejemplo:

```text
node2 OFFLINE

node1 Leader
node3 Follower

quorum = 2
```

Las entradas nuevas pueden confirmarse con:

```text
node1 + node3
```

Cuando `node2` regresa, el Leader utiliza `nextIndex` y `AppendEntries` para enviarle las entradas faltantes hasta que su log vuelva a coincidir con el cluster.

---

## 22. API REST de negocio

### Estado del nodo

```http
GET /api
```

Devuelve información del servicio y del estado Raft local.

---

## 23. Lecturas

```http
GET /api/productos
GET /api/productos/:id
```

Los GET consultan la base MongoDB local del nodo.

No ejecutan consenso Raft.

Por este motivo, un follower que esté temporalmente recuperándose podría ofrecer una lectura atrasada.

Para el alcance de este trabajo práctico se utilizan lecturas locales y no se implementan mecanismos adicionales de lectura fuerte como ReadIndex.

---

## 24. Escrituras mediante Raft

Las siguientes operaciones son **Leader-only**:

```http
POST   /api/productos
PUT    /api/productos/:id
DELETE /api/productos/:id
```

Si se envía una escritura a un follower:

```json
{
  "ok": false,
  "error": "NOT_LEADER",
  "nodeId": "node2",
  "role": "FOLLOWER",
  "term": 16,
  "leaderId": "node1"
}
```

Respuesta HTTP:

```text
409 Conflict
```

El cliente puede volver a intentar la operación sobre el Leader informado.

---

## 25. Flujo de una escritura

```text
Cliente
   │
   ▼
POST / PUT / DELETE
   │
   ▼
¿Nodo Leader?
   │
   ├── NO → 409 NOT_LEADER
   │
   └── SÍ
        │
        ▼
crear comando
        │
        ▼
append local log
        │
        ▼
AppendEntries
        │
        ▼
quorum
        │
        ▼
commitIndex
        │
        ▼
State Machine
        │
        ▼
MongoDB
```

---

## 26. Reserva sin lock – demostración TP2

```http
POST /api/productos/:id/reservar-sin-lock
```

Este endpoint se conserva exclusivamente para demostrar la condición de carrera estudiada en TP2.

Características:

```text
sin Redis lock
sin Raft
modifica únicamente MongoDB local
deliberadamente vulnerable
```

> No debe considerarse una operación distribuida válida del TP4.

---

## 27. Reserva distribuida – Redis + Raft

```http
POST /api/productos/:id/reservar
```

La reserva protegida utiliza Redis/Memurai y Raft, pero cada tecnología resuelve un problema distinto.

### Redis / Memurai

```text
exclusión mutua
```

Evita que dos operaciones simultáneas sobre el mismo producto entren a la sección crítica.

### Raft

```text
consenso + replicación
```

Replica la única operación aceptada y determina cuándo puede considerarse committed.

---

## 28. Idempotencia de PRODUCT_RESERVE

Para aplicar la reserva no se utiliza:

```javascript
$inc: { stock: -1 }
```

El Leader determina previamente:

```text
stockBefore
stockAfter
```

y la State Machine aplica el valor final mediante `$set`.

Si una entrada debe reaplicarse, el resultado vuelve al mismo `stockAfter` en lugar de decrementar nuevamente.

---

## 29. Lock Redis

La granularidad utilizada es por producto:

```text
producto:<id>
```

El lock posee:

- ownership/token;
- liberación segura;
- TTL.

Configuración utilizada para la demostración:

```text
delay de sección crítica = 3000 ms
TTL del lock             = 10000 ms
```

El TTL debe ser mayor al delay intencional más el tiempo esperado de replicación y commit.

---

## 30. Prueba de concurrencia

Ejecutar simultáneamente en dos terminales:

```cmd
curl.exe -i -X POST http://127.0.0.1:3000/api/productos/6aa2c589555ab594ffcadf0a/reservar
```

Resultado esperado:

```text
una solicitud → HTTP 200 OK
otra solicitud → HTTP 423 Locked
```

Sólo una entrada nueva `PRODUCT_RESERVE` debe aparecer en el log Raft.

Esto demuestra:

```text
Redis → impide acceso concurrente a la sección crítica
Raft  → replica y confirma la única operación aceptada
```

---

## 31. Endpoints internos Raft

Los endpoints internos actuales son:

```http
GET  /raft/status
GET  /raft/log

POST /raft/request-vote
POST /raft/append-entries
POST /raft/command
```

`/raft/command` es el mecanismo interno utilizado por la API REST para ingresar comandos al consenso.

`RequestVote` y `AppendEntries` forman parte del protocolo interno y no de la API de negocio.

---

## 32. Consultar el estado del cluster

```cmd
curl.exe http://127.0.0.1:4001/raft/status
curl.exe http://127.0.0.1:4002/raft/status
curl.exe http://127.0.0.1:4003/raft/status
```

Debe observarse un único Leader por término estable y el mismo `leaderId` en los followers.

---

## 33. Consultar el log

```cmd
curl.exe http://127.0.0.1:4001/raft/log
curl.exe http://127.0.0.1:4002/raft/log
curl.exe http://127.0.0.1:4003/raft/log
```

Debe comprobarse que las entradas committed converjan entre los tres nodos.

En el Leader también pueden observarse:

```text
nextIndex
matchIndex
```

---

## 34. Swagger / OpenAPI

Cada nodo expone su propia documentación:

```text
node1 → http://127.0.0.1:3000/api-docs
node2 → http://127.0.0.1:3001/api-docs
node3 → http://127.0.0.1:3002/api-docs
```

Los grupos principales son:

```text
General
Productos
Concurrencia
RAFT
```

Los endpoints Raft declaran un `server` específico apuntando al puerto interno correspondiente.

Ejemplo para node1:

```text
GET /raft/status
→ http://127.0.0.1:4001/raft/status
```

### Recomendación para pruebas

Es seguro utilizar `Try it out` sobre:

```text
GET /raft/status
GET /raft/log
```

No se recomienda disparar manualmente `RequestVote` o `AppendEntries` sobre un cluster activo únicamente para explorar Swagger, porque son RPC que modifican estado interno de Raft.

---

## 35. CORS

Swagger UI utiliza el puerto de la API REST y Raft utiliza otro origen.

Ejemplo:

```text
Swagger → http://127.0.0.1:3000
Raft    → http://127.0.0.1:4001
```

El servidor interno Raft habilita CORS para permitir las consultas desde Swagger UI.

---

## 36. Logging

Cada nodo mantiene sus propios logs:

```text
logs/
├── node1/
├── node2/
└── node3/
```

Eventos relevantes pueden incluir:

```text
RAFT_ELECTION_TIMER
RAFT_ELECTION_TIMEOUT
RAFT_BECOME_CANDIDATE
RAFT_ELECTION_STARTED
RAFT_REQUEST_VOTE_RX
RAFT_VOTE_GRANTED
RAFT_VOTE_REJECTED
RAFT_VOTE_RECEIVED
RAFT_ELECTION_NO_QUORUM
RAFT_BECOME_LEADER
RAFT_HIGHER_TERM
RAFT_STEP_DOWN

RAFT_APPEND_ENTRIES_RX
RAFT_APPEND_ENTRIES_APPLIED
RAFT_HEARTBEAT_RX

RAFT_REPLICATION_SUCCESS
RAFT_REPLICATION_REJECTED
RAFT_COMMIT_ADVANCED

RAFT_STATE_MACHINE_APPLY
RAFT_STATE_MACHINE_APPLIED

RAFT_PERSISTENCE_LOADED
RAFT_PERSISTED
```

---

## 37. Pruebas funcionales recomendadas

### Escenario A – Elección con tres nodos

Esperado:

```text
1 LEADER
2 FOLLOWERS
mismo currentTerm
mismo leaderId
```

### Escenario B – Follower rechaza escritura

Enviar un POST a un follower.

Esperado:

```text
409 NOT_LEADER
```

### Escenario C – CRUD mediante Raft

Ejecutar `POST`, `PUT` y `DELETE` sobre el Leader y comprobar:

```text
mismo logLength
mismo commitIndex
mismo lastApplied
mismo contenido committed
```

### Escenario D – Caída del Leader

Detener el Leader y comprobar nueva elección e incremento de `currentTerm`.

### Escenario E – Quorum con dos nodos

Con un nodo fuera de servicio, el cluster conserva `2/3` y puede confirmar nuevas entradas.

### Escenario F – Sin quorum

Con un único nodo activo no pueden confirmarse nuevas escrituras.

### Escenario G – Catch-up de follower

1. detener un follower;
2. crear una entrada con los otros dos nodos;
3. reiniciar el follower;
4. observar el retroceso de `nextIndex`;
5. comprobar convergencia de logs.

### Escenario H – Persistencia

1. crear entradas committed;
2. consultar `/raft/log`;
3. detener los tres nodos;
4. reiniciarlos;
5. esperar una nueva elección;
6. consultar nuevamente `/raft/log`.

Esperado:

```text
log conservado
commitIndex conservado
lastApplied conservado
currentTerm no retrocede
```

### Escenario I – Concurrencia Redis + Raft

Enviar dos reservas simultáneas al Leader.

Esperado:

```text
una → 200 OK
otra → 423 Locked
```

y una sola nueva entrada `PRODUCT_RESERVE`.

---

## 38. Evidencias obtenidas durante el desarrollo

Durante las pruebas se verificó:

```text
✓ Elección automática de Leader
✓ Heartbeats
✓ Cambio de Leader
✓ Incremento monotónico de currentTerm
✓ Persistencia de currentTerm y votedFor
✓ Replicación de entradas
✓ nextIndex / matchIndex
✓ Backtracking de nextIndex
✓ Commit por mayoría
✓ State Machine
✓ MongoDB independiente por nodo
✓ Recuperación de follower atrasado
✓ Persistencia del log Raft
✓ Persistencia de commitIndex
✓ Persistencia de lastApplied
✓ Reinicio completo del cluster
✓ POST REST mediante Raft
✓ PUT REST mediante Raft
✓ DELETE REST mediante Raft
✓ PRODUCT_RESERVE mediante Raft
✓ Redis distributed lock
✓ 200 + 423 en solicitudes concurrentes
✓ Una sola reserva concurrente incorporada al log
✓ Swagger sobre API REST y servidor Raft
```

---

## 39. Seguridad y archivos que no deben entregarse

No incluir:

```text
node_modules/
.env
claves privadas
PFX reales utilizados en desarrollo
credenciales
tokens
logs voluminosos
```

Sí incluir:

```text
.env.example
package.json
package-lock.json
README.md
código fuente
documentación solicitada
evidencias necesarias
```

Un archivo PFX puede contener la clave privada, por lo que un certificado real de desarrollo no debe incluirse en la entrega.

---

## 40. Cierre controlado

Para detener un nodo:

```text
Ctrl + C
```

El servicio captura `SIGINT` / `SIGTERM`.

Antes de finalizar:

1. detiene heartbeat;
2. detiene election timer;
3. persiste el snapshot actual de Raft;
4. cierra los servidores;
5. desconecta MongoDB.

La seguridad de Raft no debe depender únicamente del shutdown controlado: los cambios críticos también se persisten durante la operación normal.

---

## 41. Evolución de los trabajos prácticos

```text
TP1
REST + CRUD
   ↓
TP2
HTTPS + concurrencia + Redis locks
   ↓
TP3
MongoDB + Mongoose + Winston + Swagger
   ↓
TP4
Raft + múltiples nodos + Leader
+ replicated log + quorum + commit
+ State Machine + failover + persistencia
```

---

## 42. Conceptos principales

El TP4 busca mostrar que:

> **Replicar un servicio no garantiza que sus réplicas estén de acuerdo.**

Raft incorpora reglas para decidir:

- quién puede coordinar escrituras;
- en qué orden deben ejecutarse;
- cuándo una entrada puede considerarse committed;
- cómo recuperar un follower atrasado;
- cómo continuar frente a la caída del Leader.

A su vez:

```text
Redis / Memurai → exclusión mutua
Raft            → consenso y replicación
MongoDB         → persistencia de cada réplica
```

Son mecanismos diferentes y complementarios.

---

## 43. Alcance de la implementación

La implementación realizada es una versión educativa y simplificada de Raft.

El objetivo es demostrar de forma observable:

- elección de Leader;
- términos y votos;
- heartbeats;
- replicated log;
- quorum;
- commit;
- State Machine;
- recuperación de followers;
- persistencia;
- integración con una API REST.

No se busca reemplazar una implementación de Raft preparada para producción ni cubrir todas las optimizaciones y extensiones del algoritmo formal.
