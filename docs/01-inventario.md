# 1. Inventario de la aplicación existente

**Versión relevada:** `app-base/`, la que quedará marcada con el tag `tp5-base`. Es el
mismo código que el commit `d497876` (TP4 de Santiago Vicente), solo trasladado a
`app-base/`.

**Cómo se relevó:** se siguió cada endpoint por todo su recorrido (ruta → middleware →
controlador → Raft → State Machine → MongoDB) y se anotaron las reglas, los datos que
lee y escribe y sus dependencias. Además, cada endpoint y cada regla se probaron contra
un cluster local de 3 nodos levantado desde un clon limpio del repositorio.

## Vista general

La aplicación es **una sola base de código** (un monolito replicado). Cada nodo del
cluster (`nodo1`, `nodo2` y `nodo3`) ejecuta el mismo proceso Node.js/Express, con dos
servidores HTTP:

| Servidor | Puertos | Para qué |
|---|---|---|
| API externa | HTTP 3001–3003 · HTTPS 3441–3443 | Negocio (productos) y diagnóstico del cluster. Swagger en `/api-docs` |
| RPC interno de Raft | HTTP 4001–4003 | Comunicación entre nodos (elección y replicación). Swagger en `/raft-docs` |

Capas por las que pasa una petición:

```
routes/  →  middlewares/soloLeader (solo escrituras)  →  controllers/productos.controller
                                                            │
                     lecturas: directo a Mongo  ◄───────────┤
                                                            ▼ escrituras
                                     raft/raftNode.proponer()  →  replicación a los peers
                                                            ▼ commit por mayoría (2/3)
                                     raft/stateMachine.aplicar()  →  models/Producto  →  MongoDB del nodo
```

Servicios externos que usa: **MongoDB** (una base por nodo en el mismo servidor) y
**Redis/Memurai** (solo para el lock de la compra).

## 1.1 Recursos y entidades principales

| Entidad | Descripción | Atributos principales | Dónde se persiste |
|---|---|---|---|
| **Producto** | Artículo del catálogo, con su precio y su stock disponible. Es la única entidad de negocio | `_id` (ObjectId), `nombre` (único), `precio`, `stock`, `categoria`, `version`, `ultimoIndiceRaft`, `createdAt`, `updatedAt` | Colección `productos` de la base de cada nodo (`tp4_nodo1`, `tp4_nodo2`, `tp4_nodo3`) |
| **Categoría** | No es una entidad: es una lista fija de valores posibles para `producto.categoria` | `periferico`, `monitor`, `accesorio`, `otro` | Escrita en el código (`CATEGORIAS` en `models/producto.model.js`) |
| **Compra** | No es una entidad persistida: una compra solo descuenta stock. No queda un registro de ventas ni de pedidos | `cantidad`, `stockLeido`, `stockNuevo` | Solo como comando `COMPRAR_PRODUCTO` dentro del log Raft (`raft_log`) |
| **Entrada del log Raft** | Comando de escritura replicado entre los nodos | `index` (único), `term`, `comando` (objeto libre con `tipo`), `creadaEn` | Colección `raft_log` de cada nodo |
| **Estado Raft persistente** | Lo que un nodo necesita recordar tras reiniciarse | `_id: "estado"`, `currentTerm`, `votedFor`, `commitIndex`, `lastApplied` | Colección `raft_estado` de cada nodo (un único documento) |
| **Lock de compra** | Exclusión mutua para que dos compras del mismo producto no se pisen | clave `lock:producto:<id>`, valor `ownerId` (UUID), TTL en ms | Redis/Memurai (en memoria, expira solo) |
| **Nodo del cluster** | Configuración estática de cada réplica | `id`, `host`, `apiHttpPort`, `apiHttpsPort`, `raftPort` | Archivo `cluster.json` |

Detalle de los atributos de **Producto** (`models/producto.model.js`):

| Atributo | Tipo | Restricciones | Quién lo fija |
|---|---|---|---|
| `nombre` | String | obligatorio, único, sin espacios al inicio ni al final (`trim`), no vacío | Cliente |
| `precio` | Number | obligatorio, ≥ 0.01 | Cliente |
| `stock` | Number | obligatorio, entero, ≥ 0 | Cliente (alta y PUT) o la compra |
| `categoria` | String | uno de los valores de `CATEGORIAS`; por defecto `otro` | Cliente |
| `version` | Number | empieza en 1 y suma 1 en cada modificación | State Machine |
| `ultimoIndiceRaft` | Number | índice de la última entrada del log que modificó el documento | State Machine |
| `createdAt` / `updatedAt` | Date | vienen dentro del comando: los fija el Leader una sola vez | Controlador (Leader) |

## 1.2 Endpoints y operaciones

Abreviaturas: **L** = lee · **E** = escribe. Las escrituras que pasan por Raft modifican
las colecciones **en los 3 nodos**, porque cada réplica aplica el mismo comando sobre su
propia base.

### API de negocio: productos (`routes/productos.routes.js`)

| Funcionalidad / endpoint | Responsabilidad actual | Datos utilizados | Dependencias | Módulo / función |
|---|---|---|---|---|
| `GET /api/productos` | Listar productos ordenados por fecha de alta. Filtros opcionales: `nombreContiene` (búsqueda sin distinguir mayúsculas) y `categoria`. Lectura **local**: responde el nodo que recibe la petición, sea Leader o follower | L: `productos` | Lista `CATEGORIAS` del modelo | `productos.controller.listarProductos` |
| `GET /api/productos/:id` | Consultar un producto por id. Lectura local | L: `productos` | — | `productos.controller.obtenerProductoPorId` |
| `POST /api/productos` | Alta de producto. Valida los datos contra el schema, verifica que el nombre no exista, genera el `_id` y la fecha, y propone el comando `CREAR_PRODUCTO` a Raft. Responde recién cuando la entrada quedó confirmada y aplicada (201) | L: `productos` (unicidad del nombre) · E: `raft_log`, `raft_estado`, `productos` | `soloLeader`, `RaftNode.proponer`, State Machine | `productos.controller.crearProducto` → `stateMachine.crear` |
| `PUT /api/productos/:id` | Modificación **parcial** de nombre, precio, stock y/o categoría. Valida el resultado, vuelve a verificar la unicidad si cambia el nombre y propone `ACTUALIZAR_PRODUCTO`. Suma 1 a `version` | L: `productos` (existencia y unicidad) · E: `raft_log`, `raft_estado`, `productos` | `soloLeader`, `RaftNode.proponer`, State Machine | `productos.controller.actualizarProducto` → `stateMachine.actualizar` |
| `DELETE /api/productos/:id` | Baja física del producto (se borra el documento). Propone `ELIMINAR_PRODUCTO` y responde 204 | L: `productos` (existencia) · E: `raft_log`, `raft_estado`, `productos` | `soloLeader`, `RaftNode.proponer`, State Machine | `productos.controller.eliminarProducto` → `stateMachine.eliminar` |
| `POST /api/productos/:id/comprar` | Comprar `cantidad` unidades. Toma un lock en Redis por producto, lee el stock, valida que alcance, espera un delay artificial (`COMPRA_DELAY_MS`), propone `COMPRAR_PRODUCTO` con el stock resultante ya calculado y libera el lock cuando la entrada se aplicó. Responde nombre, unidades compradas y stock restante | L: `productos.stock`, `productos.nombre` · E: lock en Redis, `raft_log`, `raft_estado`, `productos.stock` y `productos.version` | Redis/Memurai, `soloLeader`, `RaftNode.proponer`, State Machine | `productos.controller.comprarProducto` → `stateMachine.comprar` → `stateMachine.actualizar` |

Respuestas comunes a todas las escrituras:
- **421** si el nodo es follower: no aplica nada e informa quién es el Leader (cuerpo
  `leader.apiUrl` y header `X-Raft-Leader`).
- **503** si no hay Leader conocido, o si la entrada no logró mayoría dentro de
  `RAFT_COMMIT_TIMEOUT_MS` (5 s por defecto).
- Si la escritura sale bien, la respuesta trae los headers `X-Raft-Index` y `X-Raft-Term`.
  Todas las respuestas de la API externa llevan además `X-Raft-Nodo`.
