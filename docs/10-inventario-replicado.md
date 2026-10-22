# 10. Inventario replicado

> TP6 · Parte 2 · Responsable: Santiago Vicente. Código en [`services/inventario/`](../services/inventario/).
> Implementa la ficha de Inventario de [`04-microservicios.md`](./04-microservicios.md) §4.2, los
> contratos C2, C3 y C4 de [`06-comunicaciones.md`](./06-comunicaciones.md) §6.2 y las decisiones
> D1, D2, D3 y D6 de [`08-ratificacion-tp6.md`](./08-ratificacion-tp6.md).

Inventario es la única autoridad sobre cuántas unidades hay de cada producto. Corre como un
**cluster Raft de 3 nodos** (`inventario-1..3`) que usa el protocolo del TP4, pero ahora como
módulo de infraestructura: el resto del sistema no se entera de que hay un cluster.

## 10.1 Cómo se separó Raft del negocio (Caso 4 del TP5)

En el TP4, la State Machine importaba el modelo `Producto` y enumeraba las operaciones del
negocio, y los controladores armaban comandos y headers del protocolo. Ahora
`src/raft/` recibe **comandos opacos** y una función `aplicar(entrada)` que provee el servicio.

| Archivo del TP4 (`app-base/src/`) | En Inventario | Qué cambió |
|---|---|---|
| `raft/raftNode.js` | `src/raft/raftNode.js` | La State Machine, el logger y la configuración se **inyectan**; no lee `process.env` ni importa nada de negocio |
| `raft/storage.js` | `src/raft/storage.js` | Igual (`raft_estado`, `raft_log` en la base del nodo) |
| `raft/raftApp.js` | `src/raft/raftApp.js` | Recibe el nodo Raft por parámetro (sin el singleton `getRaft()`) |
| `raft/rpcClient.js` | `src/raft/rpcClient.js` | El timeout llega por parámetro |
| `raft/stateMachine.js` | **Reemplazado** por `src/stock/stateMachine.js` | Solo sabe de stock; vive fuera del módulo |
| `raft/instancia.js` | Eliminado | El nodo se inyecta en controladores y middlewares |
| `middlewares/soloLeader.js` | Reemplazado por `src/middlewares/reenviarAlLeader.js` | D1 (§10.5) |
| `config/cluster.js` + `cluster.json` | `src/config/cluster.js` + `cluster.*.json` | Lee `CLUSTER_FILE` y `RAFT_NODO_ID` (§10.6) |
| `lib/lock.js` | `src/lib/lock.js` | `REDIS_URL`, locks ordenados, espera breve (§10.3) |

Interfaz que usa el servicio (`src/raft/index.js`):

```js
const raft = crearNodoRaft({ cluster, aplicar: stateMachine.aplicar, logger, config });
await raft.iniciar();                                  // recupera término, voto y log
await raft.escuchar();                                 // abre el puerto RPC y arranca el timer
const { index, term, resultado } = await raft.proponer(comando);
raft.esLeader(); raft.leader(); raft.estado(); raft.entradasLog({ desde, hasta });
```

Verificación de que quedó desacoplado (sin resultados):

```bash
grep -rn "require(" services/inventario/src/raft | grep -vE "node:|mongoose|express|swagger|\./"
```

Los contratos de negocio **ya no exponen** `X-Raft-Index`, `X-Raft-Term` ni `version`. El
diagnóstico sigue en `/api/cluster/estado` y `/api/cluster/log`.

## 10.2 La State Machine de stock (Caso 2 del TP5)

`src/stock/stateMachine.js` es el único lugar que escribe `stock`, `descuentos` y
`movimientos`. Comandos:

| Comando | Lo propone | Qué hace al aplicarse |
|---|---|---|
| `ALTA_STOCK` / `AJUSTAR_STOCK` | `PUT /stock/:productoId` | Fija la cantidad y registra un movimiento `ALTA` o `AJUSTE` con la diferencia |
| `DESCONTAR` | `POST /descuentos` (C2) | Si la referencia ya existe, no hace nada (idempotente). Si a algún ítem no le alcanza, rechaza **todo** con los faltantes. Si alcanza, descuenta con `$inc` sobre el valor vigente y registra un movimiento por ítem |
| `REINTEGRAR` | `DELETE /descuentos/:referencia` (C3) | Devuelve exactamente lo descontado con esa referencia; si ya estaba reintegrado, no hace nada |
| `NOOP` | El Leader al asumir | Nada (regla de Raft para confirmar entradas de términos anteriores) |

**La corrección del Caso 2:** la decisión "¿alcanza el stock?" se toma **al aplicar**, sobre el
valor vigente. En el TP4 la compra calculaba `stockNuevo = stockLeido − cantidad` afuera y la
State Machine pisaba el stock con ese número. Ahora nadie de afuera envía "el stock vale N"
como resultado de una cuenta propia.

**Por qué es determinística** (las 3 réplicas llegan al mismo estado):

- La `fecha` la fija el Leader **dentro del comando**; la State Machine nunca llama a `Date.now()`.
- No hace HTTP ni toca Redis: la consulta a Catálogo (C4) y el lock ocurren en `stockService`,
  en el Leader, **antes** de proponer.
- Los rechazos de negocio son resultados, no excepciones: todas las réplicas rechazan igual.
- Re-aplicar una entrada después de un reinicio no duplica nada: cada documento de stock
  guarda `ultimoIndiceRaft` y los movimientos son únicos por `(indiceRaft, productoId)`.

## 10.3 Por qué sigue existiendo el lock

Si el cálculo ya se hace al aplicar, el stock queda correcto aunque no hubiera lock. Se
mantiene igual por dos motivos:

1. **Evita proponer al log comandos que van a ser rechazados.** Bajo el lock, el Leader
   chequea la referencia y los faltantes sobre su base, que ya incluye todas las operaciones
   anteriores sobre esos productos. Si va a fallar, responde `409` sin escribir en el log.
2. **Mantiene la regla R8 que decidió el TP5:** las operaciones sobre un mismo producto se
   hacen de a una, incluidos los ajustes manuales (`PUT /stock`).

Cambios respecto del TP4: la URL sale de `REDIS_URL`; los locks de varios productos se toman
**ordenados por `productoId`** (dos descuentos con los mismos productos no se bloquean
mutuamente); si el lock está ocupado se reintenta cada 50 ms hasta `LOCK_WAIT_MS` (400 ms)
antes de responder `409`; y con Redis caído las escrituras responden `503` al instante
(`disableOfflineQueue`), mientras las lecturas siguen funcionando.

## 10.4 Presupuesto de tiempos (D3)

Una escritura tiene que responder dentro de los 3000 ms que espera Ventas:

| Tramo | Máximo | Variable |
|---|---|---|
| Espera del lock | 400 ms | `LOCK_WAIT_MS` |
| Commit de Raft | 2500 ms | `RAFT_COMMIT_TIMEOUT_MS` |
| Reenvío desde un follower y red | ~100 ms | — |
| **Total** | **~3000 ms** | |

Si no se alcanza mayoría en 2500 ms, Inventario responde `503` antes de que Ventas corte. La
entrada puede quedar en el log del Leader y confirmarse más tarde: por eso Ventas compensa con
`DELETE /descuentos/:compraId` (C3), que es idempotente.

## 10.5 Cómo se llega al Leader (D1)

Los 3 nodos comparten el alias DNS `inventario-service` en Compose. Si una escritura (`PUT
/stock`, `POST /descuentos`, `DELETE /descuentos`) cae en un follower,
`reenviarAlLeader` la reenvía al Leader (`leader.apiUrl` sale de la topología, nunca
`localhost`) y devuelve su respuesta tal cual.

- Ventas nunca recibe un `421` ni headers de Raft.
- El header `X-Reenviado-Por` evita bucles: un pedido reenviado no se vuelve a reenviar.
- `503` solo si no hay Leader conocido (elección en curso) o el Leader no responde.
- Las lecturas (`GET /stock`, `GET /movimientos`) las responde el nodo que atiende, con su
  base local: pueden estar un instante atrasadas respecto del Leader (R11).

## 10.6 Topología por configuración

| Archivo | Uso | Hosts y puertos |
|---|---|---|
| `cluster.local.json` | `npm start` | `localhost`, API 3201–3203, Raft 4201–4203 |
| `cluster.docker.json` | Docker Compose | `inventario-1..3`, API 3200, Raft 4200 |
| `cluster.solo.json` | Prueba de la imagen sola | Un nodo, que es Leader de sí mismo |

El proceso elige el archivo con `CLUSTER_FILE` y su fila con `RAFT_NODO_ID`. Si `PORT` está
definido y no coincide con el `apiHttpPort` del nodo, el proceso no arranca y explica por qué.
Cada nodo usa su propia base (`MONGODB_URI` → `inventario_nodo1..3`, D2).

## 10.7 Cómo leer `/api/cluster/estado`

```bash
node services/inventario/scripts/estado-cluster.js
```

| Campo | Significado |
|---|---|
| `rol` | `LEADER`, `FOLLOWER` o `CANDIDATE` |
| `termino` | Término actual; sube en cada elección |
| `leaderConocido` | Id y `apiUrl` del Leader, a donde se reenvían las escrituras |
| `log.commitIndex` / `log.lastApplied` | Última entrada confirmada por mayoría / última aplicada a la base |
| `replicacion` (solo en el Leader) | `matchIndex` de cada peer y si responde |

## 10.8 Resultados de las pruebas

Detalle y comandos para repetirlas en [`evidencias/inventario-pruebas.md`](./evidencias/inventario-pruebas.md).

| Prueba | Resultado |
|---|---|
| Contratos C2, C3 y C4 (201, 200 idempotente, 409 con faltantes, 204, 404, C4 404/409) | ✅ |
| Escrituras enviadas a un follower (D1) | ✅ se reenvían; sin `421` ni `X-Raft-*` |
| 10 descuentos concurrentes de 1 unidad sobre stock 20, por dos nodos | ✅ 10 `201` y stock final 10 en los 3 nodos |
| Failover: se detiene el Leader | ✅ `503` controlado y a los 4 s `201` con el Leader nuevo |
| Nodo caído que vuelve | ✅ se pone al día; `comparar-bases.js` → CONVERGEN |
| Caso 2 del TP5 corregido | ✅ ver abajo |
| Redis caído | ✅ escrituras `503` en 37 ms, lecturas `200`; se recupera solo |
| Imagen Docker y cluster en Compose | ⏳ pendiente (Docker no disponible en el equipo al momento de escribir esto) |

**El Caso 2, corregido.** Con `DESCUENTO_DELAY_MS=3000` y `LOCK_WAIT_MS=5000`, partiendo de stock 10:

| Orden de las operaciones | TP4 | TP6 | Movimientos registrados |
|---|---|---|---|
| A: el descuento de 2 empieza primero y el ajuste a 50 llega 1 s después | 8 | **50** | `ALTA +10 → 10` · `DESCUENTO −2 → 8` · `AJUSTE +42 → 50` |
| B: el ajuste a 50 se confirma primero y después el descuento de 2 | — | **48** | `AJUSTE → 50` · `DESCUENTO −2 → 48` |

Los dos resultados del TP6 son correctos porque corresponden a un orden real de las operaciones.
Con el lock, el ajuste del orden A espera a que termine el descuento (2 s), así que es la última
palabra. El 8 del TP4 no correspondía a **ningún** orden posible: era la reposición perdida.
