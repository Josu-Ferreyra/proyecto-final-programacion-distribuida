# 4. Propuesta de microservicios

> **Entregables 10 y 11** (sección 8 del TP). Parte 2 · Responsable: Santiago Vicente.
>
> Se apoya en [`02-responsabilidades.md`](./02-responsabilidades.md) (grupos A–D, reglas
> R1–R12) y en [`03-acoplamientos.md`](./03-acoplamientos.md) (Casos 1–4). Los contratos
> entre servicios coinciden con [`05-propiedad-datos.md`](./05-propiedad-datos.md) y
> [`06-comunicaciones.md`](./06-comunicaciones.md) (comunicaciones C1–C4).
>
> **Convención de nombres:** los endpoints **actuales** (TP4) llevan el prefijo `/api`; los
> **propuestos** se escriben sin prefijo, igual que en los documentos de la Parte 3.

## 4.1 Alternativas evaluadas y decisión

### Alternativa A: Catálogo · Inventario · Ventas (+ Raft como infraestructura)

Un servicio por responsabilidad de negocio (grupos A, B y C). La replicación (grupo D) no es
un servicio: es un módulo que cada servicio usa para desplegarse en cluster.

### Alternativa B: Productos · Consenso

Mantener la API de productos tal cual (CRUD y compra en un servicio) y sacar Raft a un
"servicio de consenso" al que se le mandan las escrituras.

### Alternativa C: Productos · Categorías · Stock · Compras · Cluster

Un servicio por entidad o controlador que aparece en el código o en los datos.

### Comparación

| Criterio | A: Catálogo · Inventario · Ventas | B: Productos · Consenso | C: por entidad (5 servicios) |
|---|---|---|---|
| Responsabilidad explicable en una frase | ✅ en los tres | ⚠️ "Productos" sigue haciendo oferta, stock y compra | ⚠️ "Categorías" es un `enum` de 4 valores; "Cluster" no es negocio |
| Resuelve el Caso 1 (documento mezclado) | ✅ | ❌ el documento queda igual | ✅ |
| Resuelve el Caso 2 (stock sin dueño) | ✅ un solo escritor del stock | ❌ el `PUT` y la compra siguen escribiendo stock | ⚠️ depende de que Compras no escriba Stock |
| Resuelve el Caso 3 (compra con 4 responsabilidades) | ✅ Ventas coordina, Inventario decide | ❌ | ✅ |
| Resuelve el Caso 4 (consenso ↔ negocio) | ✅ Raft como librería con State Machine inyectada | ⚠️ lo empeora: el "servicio de consenso" necesita conocer el modelo de productos para aplicar, y cada escritura es una llamada remota más | ⚠️ un servicio "Cluster" separado tiene el mismo problema que B |
| Comunicaciones para registrar una compra | 2 (Ventas → Catálogo, Ventas → Inventario) | 1 por cada escritura, incluso un cambio de precio | 3+ (Compras → Productos → Categorías, Compras → Stock) |
| ¿Algún servicio existe solo por una tabla o un controlador? | No (ver la observación sobre Catálogo en `07-validacion-limites.md`) | No, pero "Consenso" existe por una capa técnica | Sí: Categorías, y Cluster por los endpoints `/api/cluster` |
| Ciclos de dependencia | No | Sí: Productos ↔ Consenso (Consenso aplica sobre la base de Productos) | Riesgo: Productos ↔ Stock al dar de alta |
| **Decisión** | ✅ **Elegida** | ❌ Descartada: separa por capa técnica, no por responsabilidad | ❌ Descartada: división por entidades, más comunicación sin reducir acoplamiento |

**Conclusión.** La alternativa A es la única que elimina los cuatro acoplamientos
documentados, sin crear servicios que existan solo por una tabla y con dependencias que no
forman ciclos (Ventas → Catálogo, Ventas → Inventario, Inventario → Catálogo). B mantiene
el problema más grave (Caso 2) y convierte el consenso en un cuello de botella remoto. C
divide de más: las categorías son un conjunto de valores que valida y expone Catálogo
(`GET /categorias`), y no tienen datos ni decisiones propias que justifiquen un servicio.

### Decisiones transversales

- **Replicación con Raft.** Se reutiliza el código del TP4 como **módulo de infraestructura**
  (Caso 4): comandos opacos y una State Machine que provee cada servicio. Cada servicio puede
  correr como su propio cluster de 3 nodos, con su propio log y su propia base, sin cambiar
  ningún contrato: para quien lo llama, un follower que responde `421` o `503` es "servicio
  no disponible". **Inventario** es el candidato prioritario (stock con consistencia fuerte).
- **Lock distribuido (Redis/Memurai).** Pasa a ser un detalle **interno de Inventario**.
  Ningún otro servicio se conecta a Redis ni sabe que existe.
- **Diagnóstico del cluster** (`/api/cluster/estado`, `/api/cluster/log`). Lo expone cada
  servicio replicado sobre su propio cluster; no es un servicio aparte.
- **Punto de entrada.** Sin API Gateway en esta etapa: el cliente llama directamente a cada
  servicio (ver [`diagrama-arquitectura.md`](./diagrama-arquitectura.md)).

---

## 4.2 Fichas de cada microservicio

### Servicio: Catálogo

| Elemento | Definición |
|---|---|
| **Nombre** | Servicio de Catálogo (`catalogo-service`) |
| **Responsabilidad principal** | Definir qué productos se ofrecen, con qué nombre, en qué categoría y a qué precio. |
| **Operaciones** | Dar de alta un producto · Modificar nombre, categoría o precio · Dar de baja un producto (baja lógica) · Consultar uno o varios productos · Buscar por texto en el nombre y por categoría · Informar las categorías válidas. |
| **Reglas de negocio** | Nombre obligatorio y sin espacios sobrantes (R1) · Nombre único (R2) · Precio mayor a 0 (R3) · Categoría ∈ {`periferico`, `monitor`, `accesorio`, `otro`}, por defecto `otro` (R5) · Un producto dado de baja **no se borra**: queda `activo = false`, porque otros servicios guardan su id. |
| **Datos propios** | Producto: `id`, `nombre`, `precio` (vigente), `categoria`, `activo`, `createdAt`, `updatedAt`. Lista de categorías válidas. **Ya no incluye `stock`.** |
| **Endpoints** | *Migran:* `GET /api/productos` → `GET /productos` (filtros `nombreContiene`, `categoria`) · `GET /api/productos/:id` → `GET /productos/:id` · `POST /api/productos` → `POST /productos` (sin `stock`) · `PUT /api/productos/:id` → `PUT /productos/:id` (solo `nombre`, `precio`, `categoria`; rechaza `stock`) · `DELETE /api/productos/:id` → `DELETE /productos/:id` (pasa a baja lógica). *Nuevos:* `GET /productos?ids=a,b,c` (consulta de varios productos, la usa Ventas en C1) · `GET /categorias`. |
| **Dependencias** | Ninguna. Ventas (C1) e Inventario (C4) lo consultan; él no consulta a nadie. |
| **Fuera de alcance** | Cuántas unidades hay y si alcanzan para una compra (Inventario) · Crear, borrar o ajustar stock al dar de alta o de baja un producto (Inventario, a pedido del cliente) · Registrar compras o calcular totales (Ventas) · El precio pagado en compras pasadas: un cambio de precio **no** modifica compras ya registradas (Ventas guarda su copia). |
| **Justificación** | Resuelve el **Caso 1**: la oferta deja de compartir documento, `version` y log con el stock, así que un cambio de precio ya no compite con las compras y se puede publicar un producto antes de tener mercadería. Contribuye al **Caso 2**, porque `PUT /productos/:id` deja de aceptar `stock` y desaparece uno de los dos caminos que hoy escriben el stock. Lo que cambia junto en el grupo A (categorías, búsqueda, precios) cambia sin tocar a nadie más, y tiene un ritmo de cambio propio: precios y categorías los cambia la administración, no las ventas. |

### Servicio: Inventario

| Elemento | Definición |
|---|---|
| **Nombre** | Servicio de Inventario (`inventario-service`) |
| **Responsabilidad principal** | Ser la única autoridad sobre cuántas unidades de cada producto están disponibles y garantizar que nunca se descuente lo que no hay. |
| **Operaciones** | Consultar la disponibilidad de uno o varios productos · Dar de alta o ajustar el stock de un producto · Descontar las unidades de una compra (todo o nada) · Reintegrar las unidades de un descuento (cancelación o compensación) · Consultar los movimientos de stock. |
| **Reglas de negocio** | Stock entero y nunca negativo (R4) · Un descuento solo procede si alcanza el stock de **todos** los ítems; si falta alguno no se descuenta nada (R7) · Las operaciones sobre el stock de un mismo producto se hacen de a una, con un lock por producto con TTL (R8); los ajustes también pasan por el lock · Los descuentos se calculan **adentro**, sobre el valor vigente: nadie de afuera envía "el stock nuevo vale N" (Caso 2) · Un descuento se identifica por la `referencia` que envía quien lo pide: repetir la misma referencia no descuenta dos veces, y el reintegro devuelve exactamente lo descontado con esa referencia · Todo cambio de stock genera un movimiento (`ALTA`, `AJUSTE`, `DESCUENTO`, `REINTEGRO`) · Un producto sin stock registrado tiene 0 unidades disponibles · Solo se da de alta stock de productos que existen y están activos en Catálogo. |
| **Datos propios** | Stock por producto (`productoId`, `cantidad`) · Descuentos por referencia (`referencia`, ítems descontados) · Movimientos de stock (`productoId`, `tipo`, `cantidad`, `referencia`, `fecha`) · Lock por producto (interno, en Redis/Memurai). |
| **Endpoints** | *Migran:* el campo `stock` de `POST /api/productos` y de `PUT /api/productos/:id` → `PUT /stock/:productoId` `{ cantidad }` · el descuento que hacía `POST /api/productos/:id/comprar` → `POST /descuentos` `{ referencia, items: [{ productoId, cantidad }] }` → `201` / `200` (referencia ya procesada) / `409 { faltantes }`. *Nuevos:* `GET /stock?productoIds=a,b,c` · `DELETE /descuentos/:referencia` → `204` / `404` · `GET /movimientos?productoId=…`. |
| **Dependencias** | **Catálogo**, solo al dar de alta el stock de un producto (C4: `GET /productos/:id`, para verificar que exista y esté activo). Los ajustes, descuentos y reintegros no consultan a nadie. |
| **Fuera de alcance** | Nombre, precio y categoría del producto (Catálogo) · Verificar en cada compra que el producto siga activo (lo verifica Ventas en C1) · Calcular totales o guardar compras (Ventas) · Decidir si una compra se puede cancelar: reintegra cuando se lo piden · Exponer el lock o los índices de Raft en su contrato. |
| **Justificación** | Resuelve el **Caso 2**: pasa a haber un solo escritor del stock, el lock vive donde vive el dato y el descuento se calcula sobre el valor vigente. Así desaparece la pérdida de actualizaciones reproducida (reposición a 50 + compra de 2 da 48, no 8). Resuelve la mitad de stock del **Caso 1** y saca de la compra la regla R7 y el lock (**Caso 3**). Es el servicio que más necesita consistencia fuerte, así que es el primero que se despliega sobre el módulo Raft (**Caso 4**), con una State Machine que solo sabe de stock. Puede evolucionar (reservas con vencimiento, varios depósitos, stock mínimo) sin cambiar su contrato `descontar / reintegrar`. |

### Servicio: Ventas

| Elemento | Definición |
|---|---|
| **Nombre** | Servicio de Ventas (`ventas-service`) |
| **Responsabilidad principal** | Concretar las compras de los clientes y llevar su ciclo de vida, dejando constancia de qué se compró, cuánto y a qué precio. |
| **Operaciones** | Registrar una compra de uno o varios productos (coordina la verificación de productos y el descuento de unidades) · Consultar una compra · Cancelar una compra. |
| **Reglas de negocio** | Cada ítem tiene una cantidad entera y mayor a 0 (R6) · Solo se venden productos que existen y están activos en Catálogo · El precio unitario y el nombre se toman de Catálogo **al momento de la compra** y quedan congelados en el ítem · Total = Σ precio unitario × cantidad, calculado una sola vez al confirmar · La compra queda `CONFIRMADA` solo si Inventario confirmó el descuento; con stock insuficiente no se guarda nada · El `compraId` lo genera Ventas y se usa como `referencia` del descuento · Solo se puede cancelar una compra `CONFIRMADA`; si Inventario no responde al reintegrar, queda `CANCELACION_PENDIENTE` y se reintenta · Si algo falla después de descontar, se compensa con el reintegro. Ventas **nunca** consulta el stock para decidir. |
| **Datos propios** | Compra: `compraId`, `estado` (`CONFIRMADA` / `CANCELACION_PENDIENTE` / `CANCELADA`), `total`, `fecha`. Ítems: `productoId`, `nombreProducto` (copia), `precioUnitario` (copia, "precio pagado"), `cantidad`. Las copias son intencionales: describen la compra como fue, aunque el catálogo cambie después. |
| **Endpoints** | *Migran:* `POST /api/productos/:id/comprar` `{ cantidad }` → `POST /compras` `{ items: [{ productoId, cantidad }] }`. *Nuevos:* `GET /compras/:id` · `PATCH /compras/:id/cancelar`. |
| **Dependencias** | **Catálogo** (C1: `GET /productos?ids=…`), para saber si los productos existen, si están activos y su precio vigente. **Inventario** (C2: `POST /descuentos`; C3: `DELETE /descuentos/:referencia`), para descontar y reintegrar unidades. |
| **Fuera de alcance** | Decidir si hay stock suficiente: lo pide, no lo calcula ni lo consulta antes (Inventario) · Tomar locks o tocar Redis · Modificar precios o productos (Catálogo) · Reponer o ajustar stock. |
| **Justificación** | Resuelve el **Caso 3**: la compra deja de ser una función que valida, bloquea, decide el stock y arma comandos de consenso. Ventas solo coordina y registra, y cada decisión queda en su dueño. Agrega el dato que hoy falta (no hay historial ni precio al momento de la compra), que es una responsabilidad nueva con reglas propias (precio congelado, total, estados, cancelación) y no una tabla inventada. Habilita lo que hoy obliga a reescribir `comprarProducto`: comprar varios productos en una operación y cancelar. Sus dependencias van en un solo sentido: ni Catálogo ni Inventario saben que Ventas existe. |

---

## 4.3 Tabla general de responsabilidades

| Microservicio | Responsabilidad | Datos administrados | Funciones principales | Dependencias |
|---|---|---|---|---|
| Catálogo | Definir qué se ofrece y a qué precio | Productos (nombre, precio vigente, categoría, activo), categorías válidas | Alta, modificación, baja lógica, consulta y búsqueda de productos; listar categorías | Ninguna |
| Inventario | Controlar las unidades disponibles y que nunca se vendan de más | Stock por producto, descuentos por referencia, movimientos | Consultar disponibilidad, alta y ajuste de stock, descontar (todo o nada), reintegrar, ver movimientos | Catálogo, solo al dar de alta stock (C4) |
| Ventas | Concretar compras y llevar su ciclo de vida | Compras e ítems (con nombre y precio pagado) | Registrar, consultar y cancelar compras | Catálogo (C1), Inventario (C2, C3) |

Las dependencias no forman ciclos: **Ventas → Catálogo**, **Ventas → Inventario** e
**Inventario → Catálogo**. Catálogo no depende de nadie, así que se puede desplegar y probar
solo. La dependencia C4 es la más discutible y está analizada en
[`07-validacion-limites.md`](./07-validacion-limites.md).

## 4.4 Funcionalidades que cambian de lugar

Cada endpoint del sistema actual tiene destino. Esta tabla es la guía para migrar el código
en el TP6.

Las columnas **Responsable** y **Estado** se agregaron en la ratificación del TP6
([`08-ratificacion-tp6.md`](./08-ratificacion-tp6.md)). Cada responsable actualiza el estado
(`pendiente` → `implementado` → `probado`) en los PRs de su servicio.

| Endpoint actual (TP4) | Servicio destino | Endpoint propuesto | Cambio | Responsable | Estado |
|---|---|---|---|---|---|
| `GET /api/productos` | Catálogo | `GET /productos` | Ya no devuelve `stock`. Para mostrar disponibilidad, el cliente consulta además `GET /stock?productoIds=…`. | Ferreyra | implementado |
| `GET /api/productos/:id` | Catálogo | `GET /productos/:id` | Ya no devuelve `stock`. | Ferreyra | implementado |
| `POST /api/productos` | Catálogo + Inventario | `POST /productos` (sin `stock`) y luego `PUT /stock/:productoId` `{ cantidad }` | Se separa en dos pedidos del cliente. Mientras no se carga el stock, el producto existe con 0 disponibles: no se vende de más. | Ferreyra (producto) · Vicente (stock) | Catálogo implementado · Inventario pendiente |
| `PUT /api/productos/:id` | Catálogo (nombre, precio, categoría) / Inventario (stock) | `PUT /productos/:id` · `PUT /stock/:productoId` | `PUT /productos/:id` rechaza `stock`. El ajuste de stock pasa por el lock de Inventario y queda como movimiento (Caso 2). | Ferreyra (producto) · Vicente (stock) | Catálogo implementado · Inventario pendiente |
| `DELETE /api/productos/:id` | Catálogo | `DELETE /productos/:id` | Pasa a baja lógica (`activo = false`). No borra stock ni compras; Ventas no vende productos inactivos. | Ferreyra | implementado |
| `POST /api/productos/:id/comprar` | Ventas (+ Inventario) | `POST /compras` `{ items }` → C2 `POST /descuentos` | Pasa a crear una compra registrada, de uno o varios productos. El descuento lo decide Inventario. | Porcari (+ Vicente) | pendiente |
| — | Catálogo | `GET /productos?ids=…`, `GET /categorias` | Nuevos. | Ferreyra | implementado |
| — | Inventario | `GET /stock?productoIds=…`, `DELETE /descuentos/:referencia`, `GET /movimientos?productoId=…` | Nuevos. | Vicente | pendiente |
| — | Ventas | `GET /compras/:id`, `PATCH /compras/:id/cancelar` | Nuevos. | Porcari | pendiente |
| `GET /api/cluster/estado`, `GET /api/cluster/log` | Cada servicio replicado | Mismos paths, sobre su propio cluster | Diagnóstico, no negocio. | Vicente | pendiente |
| `POST /raft/request-vote`, `POST /raft/append-entries`, `GET /raft/estado` | Módulo Raft dentro de cada servicio replicado | Mismos paths, puerto interno | Infraestructura; no forman parte de la API pública. | Vicente | pendiente |
| `/api-docs` | Cada servicio | `/api-docs` | Cada servicio documenta solo su propia API. | Los tres, cada uno el suyo | pendiente |

## 4.5 Coherencia con la Parte 3

Esta propuesta respeta los acuerdos de los documentos de datos, comunicaciones y diagrama, y
resuelve las "acciones derivadas" de [`07-validacion-limites.md`](./07-validacion-limites.md) §7.3:

| Acción derivada (7.3) | Dónde quedó reflejada |
|---|---|
| Agregar `GET /productos?ids=…` a Catálogo | Ficha de Catálogo, Endpoints (nuevos) |
| Agregar `GET /categorias` a Catálogo | Ficha de Catálogo, Endpoints (nuevos) y Datos propios |
| `DELETE` como baja lógica (`activo = false`) | Ficha de Catálogo, Reglas y Endpoints; tabla 4.4 |
| `stock` fuera de alcance de Catálogo; ajuste en `PUT /stock/:productoId` | Ficha de Catálogo (Fuera de alcance) y de Inventario (Endpoints) |
| Lock Redis como detalle interno de Inventario | Ficha de Inventario (Reglas, Datos propios, Fuera de alcance) |
| Dependencia Inventario → Catálogo (C4) | Ficha de Inventario, Dependencias; tabla 4.3 |
