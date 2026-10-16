# 2. Identificación de responsabilidades

> **Entregable 8** (sección 6 del TP). Parte 2 · Responsable: Santiago Vicente.
>
> Las reglas de negocio se referencian como **R1…R12** según la lista de abajo. Cuando se
> mergee el inventario (`docs/01-inventario.md`) hay que alinear esta numeración con la suya.

## 2.1 Punto de partida

La aplicación base es la API de productos del TP4: un CRUD de `productos` más una operación
de compra (`POST /api/productos/:id/comprar`), replicada en un cluster de 3 nodos con Raft.
Todo vive en **un único documento `Producto`** y en **un único controlador**
(`src/controllers/productos.controller.js`), aunque, como se ve abajo, adentro conviven
decisiones de naturaleza muy distinta.

### Reglas de negocio y de sistema detectadas

| Id | Regla | Dónde se aplica hoy |
|---|---|---|
| R1 | El nombre del producto es obligatorio y se guarda sin espacios sobrantes | `producto.model.js` (validación), `crearProducto`, `actualizarProducto` |
| R2 | No puede haber dos productos con el mismo nombre | índice único + `crearProducto` (l. 107) + `actualizarProducto` (l. 163) + `stateMachine.erroresDeNegocio` |
| R3 | El precio es obligatorio y mayor a 0 | `producto.model.js` |
| R4 | El stock es un entero y nunca negativo | `producto.model.js` |
| R5 | La categoría es una de `periferico, monitor, accesorio, otro` (por defecto `otro`) | `producto.model.js`, `listarProductos` |
| R6 | La cantidad de una compra es un entero mayor a 0 | `comprarProducto` (l. 214) |
| R7 | Una compra solo procede si el stock alcanza | `comprarProducto` (l. 245) |
| R8 | Dos compras del mismo producto no pueden leer/decidir el stock al mismo tiempo (lock con TTL) | `comprarProducto` + `lib/lock.js` (Redis) |
| R9 | Solo el Leader acepta escrituras; un follower responde 421 con el Leader | `middlewares/soloLeader.js` |
| R10 | Una escritura se aplica recién cuando una mayoría (2/3) la tiene en su log | `raft/raftNode.js` (`proponer`, commit) |
| R11 | Las lecturas se resuelven con la base local del nodo (pueden estar un instante atrasadas) | `listarProductos`, `obtenerProductoPorId` |
| R12 | Cada modificación incrementa `version`; re-aplicar una entrada ya aplicada no tiene efecto | `raft/stateMachine.js` |

## 2.2 Cómo se agruparon

Cada endpoint y cada regla se trató como una "tarjeta" y se agrupó preguntando, en este orden:
**qué decisión de negocio toma**, **qué otras tarjetas cambiarían junto con ella**, **qué
datos escribe** y **qué vocabulario usa**. No se agrupó por archivo ni por colección: por
eso un mismo endpoint (`PUT /api/productos/:id`) aparece repartido en dos grupos. Hoy
hace dos cosas distintas según el campo que se le mande.

| Grupo funcional | Funcionalidades incluidas | Reglas |
|---|---|---|
| **A. Definir la oferta de productos** | `GET /api/productos` (y filtros), `GET /api/productos/:id`, `POST /api/productos` (nombre, precio, categoría), `PUT /api/productos/:id` (nombre, precio, categoría), `DELETE /api/productos/:id` | R1, R2, R3, R5 |
| **B. Controlar la disponibilidad de unidades** | stock inicial en `POST /api/productos`, `PUT /api/productos/:id` con `stock`, descuento de stock dentro de `comprar` | R4, R7, R8 |
| **C. Concretar y registrar compras** | `POST /api/productos/:id/comprar` (la operación en sí, su respuesta y lo que debería quedar registrado) | R6 |
| **D. Replicar y confirmar escrituras (transversal)** | log Raft, elección, commit, `GET /api/cluster/estado`, `GET /api/cluster/log`, RPC `/raft/*` | R9, R10, R11, R12 |

El grupo D no es una responsabilidad de negocio, sino una forma de garantizar que cualquier
escritura sobreviva a la caída de un nodo. Se analiza igual porque hoy está entrelazado con
A, B y C (ver Caso 4 en `03-acoplamientos.md`).

---

## Grupo funcional A: Definir la oferta de productos

**Funcionalidades incluidas:** `GET /api/productos` (filtros `nombreContiene`, `categoria`),
`GET /api/productos/:id`, `POST /api/productos` y `PUT /api/productos/:id` en lo que toca a
nombre, precio y categoría, `DELETE /api/productos/:id`. Reglas R1, R2, R3, R5.

1. **¿Qué problema resuelve?** Que exista una lista de **qué se vende, con qué nombre, en qué
   categoría y a qué precio**, y que un cliente pueda buscar en ella.
2. **¿Qué operaciones realiza?** Dar de alta un producto, corregir su nombre o categoría,
   cambiar su precio, darlo de baja, consultarlo por id y buscar por nombre o categoría.
3. **¿Qué reglas contiene?** Nombre obligatorio y único (R1, R2), precio positivo (R3),
   categoría dentro de un conjunto cerrado (R5).
4. **¿Qué información necesita?** Solo la que le envía quien administra la oferta. No
   necesita saber cuántas unidades hay ni si alguien compró.
5. **¿Qué información crea o modifica?** Identificador del producto, nombre, precio,
   categoría y fechas de alta y modificación.
6. **¿Qué otras funcionalidades necesita conocer?** Ninguna. Es la fuente que los demás
   consultan, no al revés.
7. **¿Qué cambios suelen ocurrir juntos?** Agregar una categoría, agregar descripción o
   imágenes, manejar precios de lista o de oferta, cambiar el criterio de búsqueda. Todos
   cambian *cómo se presenta lo que se vende* y ninguno toca cantidades.
8. **¿Podría evolucionar de forma independiente?** **Sí.** Agregar una categoría o cambiar
   la búsqueda no afecta cómo se controla el stock ni cómo se concreta una compra. Hoy no
   puede, porque comparte documento, `version` y validación con el stock (Caso 1).

## Grupo funcional B: Controlar la disponibilidad de unidades

**Funcionalidades incluidas:** el `stock` inicial que viaja en `POST /api/productos`, el
`stock` que se puede pisar con `PUT /api/productos/:id` y el descuento de stock que hace
`comprarProducto`. Reglas R4, R7, R8.

1. **¿Qué problema resuelve?** Saber **cuántas unidades de cada producto se pueden vender** y
   garantizar que nunca se venda lo que no hay, incluso con compras concurrentes.
2. **¿Qué operaciones realiza?** Registrar el stock inicial, reponer o ajustar el stock a
   mano, consultar la disponibilidad y descontar unidades cuando se concreta una compra.
3. **¿Qué reglas contiene?** El stock es entero y no negativo (R4), solo se descuenta si
   alcanza (R7), y las decisiones sobre el stock de un mismo producto se hacen de a una (R8).
4. **¿Qué información necesita?** El identificador del producto y la cantidad a descontar o
   ajustar. **No** necesita el precio, el nombre ni la categoría (hoy el nombre aparece en
   el mensaje de error de stock insuficiente, pero solo para armar el texto).
5. **¿Qué información crea o modifica?** La cantidad disponible por producto. Hoy no deja
   rastro de *por qué* cambió (no hay movimientos), y eso es parte del problema del Caso 2.
6. **¿Qué otras funcionalidades necesita conocer?** Ninguna para decidir. Que el producto
   exista en la oferta lo verifica quien inicia la compra.
7. **¿Qué cambios suelen ocurrir juntos?** Reposiciones con motivo, stock mínimo y alertas,
   reservas temporales, varios depósitos, y cambiar el mecanismo de exclusión mutua (R8).
8. **¿Podría evolucionar de forma independiente?** **Sí, y es el grupo que más lo
   necesita.** Agregar reservas o depósitos no debería obligar a tocar precios ni la forma de
   registrar una compra. Hoy es imposible: hay **dos caminos** que escriben el stock con
   reglas distintas (el `PUT` sin lock y la compra con lock), y eso ya produce pérdidas de
   actualizaciones (Caso 2).

## Grupo funcional C: Concretar y registrar compras

**Funcionalidades incluidas:** `POST /api/productos/:id/comprar`. Regla R6, más lo que esa
operación hoy *no* hace y el negocio necesita: dejar constancia de la compra.

1. **¿Qué problema resuelve?** Que un cliente pueda **comprar** una cantidad de un producto y
   que la compra quede **registrada**, con qué se compró, cuánto y a qué precio.
2. **¿Qué operaciones realiza?** Recibir el pedido de compra, validar la cantidad, verificar
   que el producto se ofrece, conseguir que se descuenten las unidades, informar el
   resultado y (lo nuevo) guardar la compra para poder consultarla después.
3. **¿Qué reglas contiene?** Cantidad entera y positiva (R6). En cuanto se registre la
   compra se suman reglas propias: el precio se congela al momento de comprar, el total es
   precio × cantidad, y una compra rechazada por falta de stock no descuenta nada.
4. **¿Qué información necesita?** De la oferta, que el producto exista y su precio actual.
   De la disponibilidad, la confirmación de que se descontaron las unidades.
5. **¿Qué información crea o modifica?** Hoy **nada propio**: la compra solo baja el stock y
   después no hay forma de saber qué se vendió ni a qué precio. En la propuesta crea el
   registro de la compra: producto, nombre y precio al momento, cantidad, total, estado y
   fecha.
6. **¿Qué otras funcionalidades necesita conocer?** La oferta (para precio y existencia) y la
   disponibilidad (para descontar). Las conoce para **pedirles** algo, no para decidir por
   ellas.
7. **¿Qué cambios suelen ocurrir juntos?** Comprar varios productos en una operación
   (carrito), medios de pago, cancelaciones y devoluciones, historial de compras por cliente.
8. **¿Podría evolucionar de forma independiente?** **Parcialmente.** Su lógica propia (estados,
   totales, historial) puede cambiar sin tocar a los demás, pero siempre va a depender de que
   la oferta le diga el precio y de que la disponibilidad le confirme las unidades. Esa
   dependencia es aceptable porque va en un solo sentido: ni la oferta ni la disponibilidad
   necesitan saber que existen compras.

## Grupo funcional D (transversal): Replicar y confirmar escrituras

**Funcionalidades incluidas:** elección de Leader, replicación del log, commit por mayoría,
aplicación en la State Machine, `GET /api/cluster/estado`, `GET /api/cluster/log`, RPC
`/raft/request-vote`, `/raft/append-entries`, `/raft/estado`. Reglas R9–R12.

1. **¿Qué problema resuelve?** Que una escritura aceptada no se pierda si se cae un nodo, y
   que todas las réplicas terminen con el mismo estado.
2. **¿Qué operaciones realiza?** Elegir Leader, replicar comandos, confirmarlos por mayoría,
   aplicarlos en orden, exponer el estado del cluster para diagnóstico.
3. **¿Qué reglas contiene?** R9–R12. Ninguna es una regla del negocio de productos: valen
   igual para cualquier dato que se quiera replicar.
4. **¿Qué información necesita?** Comandos opacos a replicar y la lista de nodos.
5. **¿Qué información crea o modifica?** Término, voto, log Raft, `commitIndex`/`lastApplied`
   (colecciones `raft_estado` y `raft_log`).
6. **¿Qué otras funcionalidades necesita conocer?** No debería necesitar ninguna. Hoy conoce
   todos los comandos del negocio (Caso 4).
7. **¿Qué cambios suelen ocurrir juntos?** Timeouts, snapshots/compactación del log, cambio
   de miembros del cluster.
8. **¿Podría evolucionar de forma independiente?** **Sí, si se lo separa del negocio.** Por
   eso en la propuesta **no es un microservicio**, sino un módulo de infraestructura que
   cada servicio puede usar para replicarse (ver `04-microservicios.md`, §4.1).

## 2.3 Resumen

| Grupo | Responsabilidad en una frase | Decide sobre | ¿Independiente? |
|---|---|---|---|
| A. Oferta de productos | Definir qué se vende y a qué precio | nombre, precio, categoría | Sí |
| B. Disponibilidad | Garantizar que no se venda lo que no hay | cantidad disponible | Sí |
| C. Compras | Concretar una compra y dejar constancia | registro de la compra | Parcialmente (depende de A y B en un solo sentido) |
| D. Replicación (transversal) | Que ninguna escritura confirmada se pierda | log y consenso | Sí, como infraestructura |
