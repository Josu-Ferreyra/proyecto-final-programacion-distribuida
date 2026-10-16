# 5. Propiedad y acceso a los datos

> Corresponde a la sección 9 del TP (entregable 12). Usa los servicios definidos en
> [`04-microservicios.md`](./04-microservicios.md): **Catálogo**, **Inventario** y **Ventas**.

**Regla de diseño:** un servicio no modifica directamente datos que pertenecen a otro. Si
necesita un cambio, lo **pide** por la interfaz pública del servicio propietario. Ningún
servicio accede a la base de otro.

## Punto de partida: los datos de la aplicación actual

Hoy toda la información vive en una sola colección `productos` (una base Mongo por nodo
Raft) más el lock de Redis/Memurai:

| Dato actual | Dónde está hoy | Quién lo escribe hoy |
|---|---|---|
| `nombre`, `precio`, `categoria` | `productos` | `POST /api/productos`, `PUT /api/productos/:id` |
| `stock` | `productos` (mismo documento) | `POST`/`PUT /api/productos` **y** `POST /api/productos/:id/comprar` |
| Lista de categorías válidas | Enum en el código (`CATEGORIAS`) | Nadie (cambia con un deploy) |
| `version`, `ultimoIndiceRaft`, `createdAt`, `updatedAt` | `productos` | State Machine de Raft |
| `raft_estado`, `raft_log` | Base de cada nodo | Protocolo Raft |
| Lock `producto:<id>` | Redis/Memurai | `comprarProducto` |
| Registro de compras | **No existe**: comprar solo descuenta stock | — |

**Datos en disputa:** `stock` es el caso central. Lo escriben dos funcionalidades distintas
(la edición administrativa del producto y la compra) dentro del mismo documento que el
precio y el nombre. Por eso un cambio de precio y una compra compiten por el mismo
documento y la misma `version`.

## Matriz de propiedad

| Dato / recurso | Servicio propietario | Quién puede consultarlo | Quién puede modificarlo | Forma de acceso |
|---|---|---|---|---|
| Producto (nombre, categoría, activo, fechas) | Catálogo | Cliente, Ventas, Inventario | Solo Catálogo | `GET /productos`, `GET /productos/:id`, `GET /productos?ids=…` · alta `POST /productos` · edición `PUT /productos/:id` · baja lógica `DELETE /productos/:id` |
| Precio vigente | Catálogo | Cliente, Ventas | Solo Catálogo | Incluido en `GET /productos…` · se cambia con `PUT /productos/:id` |
| Categorías válidas | Catálogo | Cliente | Solo Catálogo | `GET /categorias` |
| Stock por producto | Inventario | Cliente | Solo Inventario | `GET /stock?productoIds=…` · ajuste administrativo `PUT /stock/:productoId` |
| Descuentos de stock (unidades descontadas por una compra) | Inventario | Ventas (los propios, por referencia) | Inventario, **a pedido** de Ventas | `POST /descuentos` · reintegro `DELETE /descuentos/:referencia` |
| Movimientos de stock (alta, ajuste, descuento, reintegro) | Inventario | Administración | Solo Inventario (se generan solos con cada cambio) | `GET /movimientos?productoId=…` |
| Lock de concurrencia por producto (Redis/Memurai) | Inventario (interno) | Nadie | Solo Inventario | No se expone |
| Compra y su estado | Ventas | Cliente | Solo Ventas | `POST /compras`, `GET /compras/:id`, `PATCH /compras/:id/cancelar` |
| Ítems de la compra con **precio pagado** y nombre (copia) | Ventas | Cliente | Ventas, solo al crear la compra (inmutable) | Copia local guardada al crear la compra; se lee con `GET /compras/:id` |
| Estado de replicación (`raft_estado`, `raft_log`, `version`, `ultimoIndiceRaft`) | Cada servicio, para su propia base | Diagnóstico | Solo el propio servicio | `GET /api/cluster/estado` y `/log` del servicio. **No forma parte del contrato de negocio** |

Cada fila tiene un único propietario. Los únicos casos en que un servicio produce un cambio
en datos ajenos son los descuentos y reintegros de stock, y en ambos el cambio lo ejecuta
Inventario cuando Ventas se lo pide.

## 5.1 Referencias entre servicios

| Servicio | Guarda | Referencia a | Cómo se valida |
|---|---|---|---|
| Inventario | `productoId` en cada registro de stock y movimiento | Producto de Catálogo | Al dar de alta el stock de un producto (primer `PUT /stock/:productoId`), Inventario consulta `GET /productos/:id` a Catálogo: debe existir y estar activo. Los ajustes siguientes no vuelven a consultar. |
| Ventas | `productoId` en cada ítem | Producto de Catálogo | Al crear la compra, `GET /productos?ids=…`: todos deben existir y estar activos. |
| Ventas | `compraId`, usado como `referencia` del descuento | Descuento de Inventario | Ventas no guarda un id de Inventario: el descuento se identifica por el `compraId` que Ventas generó. Así un reintento o una compensación no necesitan saber nada de Inventario. |

**No hay foreign keys entre bases distintas.** Un `productoId` guardado en Inventario o en
Ventas es solo un identificador. Por eso Catálogo **no borra productos físicamente**: el
`DELETE` pasa a ser una baja lógica (`activo = false`). Así las compras históricas y los
registros de stock siguen apuntando a un producto que existe, y la regla "no se vende un
producto inactivo" se puede aplicar.

## 5.2 Copias locales y su justificación

| Dato copiado | Origen | Quién es dueño de la copia | Por qué se copia |
|---|---|---|---|
| Precio unitario en el ítem de la compra (`precioUnitario`) | Precio vigente de Catálogo | **Ventas** ("precio pagado") | Si Catálogo cambia el precio mañana, la compra de hoy no tiene que cambiar. No es el mismo dato que el precio vigente: es un hecho histórico de la compra. |
| Nombre del producto en el ítem (`nombreProducto`) | Producto de Catálogo | Ventas | Poder mostrar el detalle de una compra sin llamar a Catálogo, incluso si el producto se renombra o se da de baja. |
| Total de la compra | Calculado por Ventas con los precios copiados | Ventas | Se calcula una sola vez, al confirmar. |

No hay ninguna copia de stock fuera de Inventario. La disponibilidad se consulta siempre al
dueño, porque es el dato que cambia con más frecuencia y el que tiene la regla más
importante ("no vender sin stock").

## 5.3 Cambios respecto de la aplicación actual

| Hoy | En la propuesta |
|---|---|
| `stock` vive en el mismo documento que `nombre` y `precio` | `stock` pasa a la base de Inventario. Catálogo ya no lo guarda. |
| `POST /api/productos` crea el producto **con** stock | Catálogo crea el producto sin stock. El stock inicial se carga en Inventario con `PUT /stock/:productoId`. |
| `PUT /api/productos/:id` permite editar `stock` | Catálogo rechaza el campo `stock`. El ajuste se hace en Inventario y queda registrado como movimiento. |
| `POST /api/productos/:id/comprar` lee y escribe `productos.stock` | Ventas recibe `POST /compras` y le **pide** a Inventario `POST /descuentos`. Ventas nunca toca el stock. |
| El lock Redis lo toma el controller de productos | El lock es un detalle interno de Inventario. Ventas no sabe que existe. |
| La compra no deja registro (solo baja el stock) | Ventas guarda la compra con sus ítems y el precio pagado. |
| `DELETE /api/productos/:id` borra el documento | Baja lógica (`activo = false`), porque otros servicios guardan referencias. |
| Las categorías son un enum en el código | Catálogo las expone con `GET /categorias`. |
| La respuesta de comprar expone `version` (detalle de la replicación) | Los contratos entre servicios no exponen `version` ni índices Raft. |
