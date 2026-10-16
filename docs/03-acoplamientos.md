# 3. Identificación de acoplamientos

> **Entregable 9** (sección 7 del TP). Parte 2 · Responsable: Santiago Vicente.
>
> Las líneas citadas corresponden al commit base `d497876`. Las reglas R1…R12 y los grupos
> A…D están definidos en `02-responsabilidades.md`.

Se documentan cuatro casos. El Caso 2 se reprodujo contra el cluster en funcionamiento y
produce un resultado incorrecto observable.

---

## Caso 1: Un mismo documento mezcla la oferta y la disponibilidad

**Evidencia en el código:** `src/models/producto.model.js`, líneas 11–44.

```js
nombre:    { type: String, required: true, trim: true, unique: true }, // oferta
precio:    { type: Number, required: true, min: 0.01 },                // oferta
stock:     { type: Number, required: true, min: 0, validate: ... },    // disponibilidad
categoria: { type: String, enum: CATEGORIAS, default: 'otro' },        // oferta
version: { type: Number, default: 1 },              // una sola versión para todo
ultimoIndiceRaft: { type: Number, default: 0 },
```

- **Componentes acoplados:** grupo A (oferta: nombre, precio, categoría) y grupo B
  (disponibilidad: stock), que comparten documento, validación, `version` y endpoints
  (`POST` y `PUT /api/productos` aceptan los cuatro campos a la vez).
- **Por qué existe:** el sistema nació como un CRUD de una sola entidad. "Producto" era lo
  único que había, así que todo dato relacionado con un producto terminó como un campo más.
- **Problema que genera:**
  - Un cambio de precio y una compra modifican **el mismo documento** y comparten `version`.
    `version` ya no indica qué cambió: un `version: 3` puede ser un precio nuevo o una venta.
  - Para crear un producto hay que mandar stock (`required`). No se puede publicar un
    producto antes de tener mercadería, ni cargar mercadería de un producto todavía no
    publicado.
  - Las lecturas de catálogo (muchas, toleran estar un poco atrasadas) y las escrituras de
    stock (frecuentes, necesitan consistencia fuerte) no se pueden tratar distinto: viajan
    en la misma fila, por el mismo log y con las mismas garantías.
- **Propuesta de desacople:** separar en dos datos con dueños distintos. **Catálogo** guarda
  nombre, precio y categoría. **Inventario** guarda la cantidad disponible por producto,
  referenciando al producto **solo por su id**. Ninguno lee la colección del otro.

## Caso 2: El stock tiene dos caminos de escritura con reglas distintas (pérdida de actualizaciones)

**Evidencia en el código:**

`src/controllers/productos.controller.js`, `actualizarProducto`, líneas 136–147: el `PUT`
acepta `stock` y lo propone a Raft **sin tomar el lock**:

```js
const { nombre, precio, stock, categoria } = req.body || {};
// ...
if (stock !== undefined) cambios.stock = stock;
```

`comprarProducto`, líneas 242–262: la compra toma el lock de Redis, pero propone un stock
**absoluto** calculado con lo que leyó antes:

```js
const producto = await Producto.findById(id);
const stockLeido = producto.stock;
// ... delay ...
const comando = { tipo: TIPOS.COMPRAR_PRODUCTO, id, cantidad,
                  stockLeido, stockNuevo: stockLeido - cantidad, ... };
```

`src/raft/stateMachine.js`, línea 100: al aplicar, se **pisa** el stock con ese valor:

```js
const resultado = await actualizar(entrada, { stock: stockNuevo });
```

**Reproducción** (cluster de 3 nodos, `COMPRA_DELAY_MS=3000`):

| t | Operación | Resultado |
|---|---|---|
| 0 s | `POST /api/productos` con `stock: 10` | 201 |
| 0 s | `POST /api/productos/:id/comprar` con `cantidad: 2` (lee 10, espera 3 s) | … |
| 1 s | `PUT /api/productos/:id` con `stock: 50` (reposición) | **200**, stock = 50 |
| 3 s | la compra propone `stockNuevo = 8` | 200, `stockRestante: 8` |
| — | `GET /api/productos/:id` | **stock = 8**. Lo correcto era 48: **se perdieron 40 unidades** |

- **Componentes acoplados:** la edición de productos (grupo A, que por el Caso 1 también
  edita stock) y la compra (grupo C), que escriben la misma cantidad sin una autoridad común.
- **Por qué existe:** la regla "una decisión sobre el stock a la vez" (R8) se implementó
  **dentro de la compra** y no en un dueño del stock. Como el stock no tiene dueño, cada
  camino que lo escribe aplica sus propias reglas: el `PUT` solo valida R4, mientras la compra
  valida R4, R7 y R8.
- **Problema que genera:** además del error ya reproducido, cualquier nueva forma de mover
  stock (devoluciones, reservas, un ajuste por inventario físico) va a ser un tercer o cuarto
  camino que también tiene que acordarse de tomar el lock y de no pisar valores. Una regla de
  negocio sin dueño termina copiada, y cada copia termina distinta.
- **Propuesta de desacople:** el stock pasa a tener **un único dueño, Inventario**, que es el
  único que lo escribe y el único que conoce el lock. Hacia afuera expone operaciones con
  intención explícita: "descontá estas cantidades para la compra X" (`POST /descuentos`) y
  "el stock de este producto se ajusta a 50" (`PUT /stock/:productoId`). Las dos pasan por el
  mismo lock, y el cálculo `stock - cantidad` se hace adentro de Inventario, sobre el valor
  vigente. Nadie de afuera envía "el stock nuevo vale N" como resultado de una cuenta propia,
  así que deja de existir la ventana entre leer y escribir.

## Caso 3: La compra es una función con cuatro responsabilidades y sin registro propio

**Evidencia en el código:** `src/controllers/productos.controller.js`, `comprarProducto`,
líneas 204–272 (≈70 líneas).

```js
if (!esCantidadValida(cantidad)) { ... }                    // compra: validar el pedido
if (!(await Producto.exists({ _id: id }))) { ... }          // oferta: ¿existe el producto?
await conectar();
const obtuvoLock = await acquireLock(recurso, ownerId, ttlMs); // infraestructura: Redis
// ...
if (stockLeido < cantidad) { ... }                          // disponibilidad: regla R7
const comando = { tipo: TIPOS.COMPRAR_PRODUCTO, ... };      // replicación: arma comando Raft
return await ejecutarComando(res, comando);
// finally: releaseLock(...)
```

- **Componentes acoplados:** la compra (grupo C), la existencia del producto (A), la regla de
  stock (B), el lock distribuido (Redis) y el armado de comandos de Raft (D), todos en la
  misma función.
- **Por qué existe:** en el TP2 se agregó el lock alrededor de la compra, y en el TP4 se metió
  Raft en el mismo lugar. Cada TP sumó una capa sobre la misma función porque era el único
  lugar donde "pasaba" la compra.
- **Problema que genera:**
  - **No queda registro de la compra.** La única huella es que bajó el stock y subió
    `version`. No se puede responder qué se vendió, cuándo ni a qué precio, y si el precio
    cambia mañana, el precio de las ventas pasadas se pierde.
  - Comprar varios productos juntos implica reescribir la función entera: el lock es por
    producto (`producto:${id}`), el comando es de un producto y la State Machine tiene un
    tipo `COMPRAR_PRODUCTO` de un solo ítem.
  - Cambiar cómo se controla el stock (por ejemplo, reservar antes de pagar) obliga a
    modificar la compra, aunque la compra en sí no haya cambiado.
- **Propuesta de desacople:** la compra pasa a un servicio de **Ventas** cuyo trabajo es
  *coordinar y registrar*, no decidir sobre el stock. Valida las cantidades, consulta a
  Catálogo el precio y la existencia (`GET /productos?ids=…`), **pide** a Inventario que
  descuente (`POST /descuentos`) y guarda la compra con el precio congelado. El lock y la
  regla R7 quedan adentro de Inventario, que es quien decide. Como el descuento es de varios
  ítems y se identifica por el `compraId`, comprar varios productos y cancelar dejan de
  requerir reescribir la función.

## Caso 4: El mecanismo de replicación conoce el negocio, y el negocio conoce el mecanismo

**Evidencia en el código:**

`src/raft/stateMachine.js`, líneas 16–24 y 110–126: el módulo de consenso importa el modelo
de negocio y enumera cada operación del negocio:

```js
const { Producto } = require('../models/producto.model');
const TIPOS = Object.freeze({ NOOP, CREAR_PRODUCTO, ACTUALIZAR_PRODUCTO,
                              ELIMINAR_PRODUCTO, COMPRAR_PRODUCTO });
// ...
switch (comando.tipo) { case TIPOS.CREAR_PRODUCTO: return crear(entrada); ... }
```

`src/controllers/productos.controller.js`, líneas 38–51: el controlador de negocio arma
comandos de Raft, publica headers del protocolo y traduce errores del protocolo:

```js
resultado = await getRaft().proponer(comando);
// ...
res.set('X-Raft-Index', String(resultado.index));
res.set('X-Raft-Term', String(resultado.term));
```

Y las rutas de negocio dependen de `soloLeader` (`productos.routes.js`, líneas 83–169).
Además, `raft_estado`/`raft_log` viven en la misma base que `productos` (`src/config/db.js`,
una sola conexión por nodo).

- **Componentes acoplados:** el grupo D (replicación) con los grupos A, B y C.
- **Por qué existe:** el TP4 tenía como objetivo replicar *esta* API, así que se escribió la
  State Machine directamente sobre el modelo `Producto`, sin una frontera entre "replicar
  comandos" y "qué hace cada comando".
- **Problema que genera:**
  - Toda operación de negocio nueva obliga a tocar el módulo de consenso (un `case` más en
    `aplicar`).
  - Es imposible separar la aplicación en servicios sin separar también el protocolo: hoy
    hay **un solo log** que ordena juntas operaciones de oferta, de stock y de compra que no
    necesitan estar ordenadas entre sí. Un cambio de precio espera en la misma fila que una
    venta.
  - El contrato HTTP del negocio expone detalles internos (`X-Raft-*`, 421 con datos del
    Leader).
- **Propuesta de desacople:** convertir Raft en un **módulo de infraestructura genérico** que
  recibe comandos opacos y una función `aplicar` provista por quien lo usa. Cada servicio que
  necesite replicarse registra su propia State Machine (la de Inventario solo sabe de stock;
  la de Catálogo, de productos). La replicación pasa a ser una forma de **desplegar** un
  servicio, no un servicio de negocio, y cada servicio tiene su propio log y su propia base.

---

## 3.5 Tabla resumen

| Caso | Acoplamiento detectado | Problema generado | Propuesta de desacople |
|---|---|---|---|
| 1 | El documento `Producto` mezcla la oferta (nombre, precio, categoría) con la disponibilidad (stock), con una sola `version` y los mismos endpoints. | No se puede publicar un producto sin stock ni cargar stock sin publicarlo; precio y ventas compiten por la misma fila y el mismo log; `version` no dice qué cambió. | Catálogo es dueño de nombre, precio y categoría; Inventario es dueño de la cantidad, referenciando al producto solo por id. |
| 2 | El stock se escribe por dos caminos con reglas distintas: el `PUT` sin lock y la compra con lock, que además pisa con un valor absoluto. | **Pérdida de actualizaciones reproducida**: reposición a 50 + compra de 2 dejó 8 en vez de 48. Cada nueva forma de mover stock sería otra copia de la regla. | Inventario es el único que escribe el stock y el único que conoce el lock; expone `POST /descuentos` (calculado sobre el valor vigente) y `PUT /stock/:productoId`, ambos bajo el mismo lock. |
| 3 | `comprarProducto` valida el pedido, chequea la oferta, toma el lock de Redis, aplica la regla de stock y arma el comando Raft, y no registra la compra. | No hay historial de ventas ni precio al momento de la compra; comprar varios productos o reservar implica reescribir la función. | Ventas coordina y registra la compra (precio congelado); le pide el descuento a Inventario, que es quien decide sobre el stock. |
| 4 | La State Machine de Raft importa `Producto` y enumera las operaciones del negocio; el controlador arma comandos y headers del protocolo. | Cada operación nueva toca el consenso; un único log ordena juntas operaciones independientes; la API expone detalles internos. | Raft como módulo de infraestructura con State Machine inyectada; cada servicio tiene su propio log y su propia base. |
