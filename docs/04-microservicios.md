# 4. Propuesta de microservicios

> **Entregables 10 y 11** (sección 8 del TP). Parte 2 · Responsable: Santiago Vicente.
>
> Se apoya en `02-responsabilidades.md` (grupos A–D, reglas R1–R12) y en
> `03-acoplamientos.md` (Casos 1–4).
>
> **Estado:** propuesta para la reunión de límites (Hito B). Los nombres de servicios, datos y
> endpoints de este documento son los que deben usar las matrices y el diagrama de la Parte 3.
> Si la reunión cambia algo, se actualiza acá primero.

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
| Comunicaciones por compra | 2 (Ventas → Catálogo, Ventas → Inventario) | 1 por cada escritura, incluso un cambio de precio | 3+ (Compras → Productos → Categorías, Compras → Stock) |
| ¿Algún servicio existe solo por una tabla o un controlador? | No | No, pero "Consenso" existe por una capa técnica | Sí: Categorías, y Cluster por los endpoints `/api/cluster` |
| Ciclos de dependencia | No | Sí: Productos ↔ Consenso (Consenso aplica sobre la base de Productos) | Riesgo: Productos ↔ Stock al dar de alta |
| **Decisión** | ✅ **Elegida** | ❌ Descartada: separa por capa técnica, no por responsabilidad | ❌ Descartada: división por entidades, más comunicación sin reducir acoplamiento |

**Conclusión.** La alternativa A es la única que elimina los cuatro acoplamientos
documentados, sin crear servicios que existan solo por una tabla y con dependencias en un
solo sentido (Ventas → Catálogo, Ventas → Inventario). B mantiene el problema más grave
(Caso 2) y convierte el consenso en un cuello de botella remoto. C divide de más: Categorías
es un conjunto fijo de valores que valida Catálogo, y no tiene datos ni decisiones propias.

### Decisiones transversales

- **Replicación con Raft.** Se reutiliza el código del TP4 como **módulo de infraestructura**
  (Caso 4): comandos opacos y una State Machine que provee cada servicio. Cada servicio que
  se replique tiene su propio cluster, su propio log y su propia base. **Inventario** es el
  candidato prioritario (stock con consistencia fuerte). Que Catálogo y Ventas también se
  repliquen es una decisión de despliegue para el TP6, no cambia los límites.
- **Lock distribuido (Redis).** Pasa a ser un detalle **interno de Inventario**. Ningún otro
  servicio se conecta a Redis.
- **Diagnóstico del cluster** (`/api/cluster/estado`, `/api/cluster/log`). Lo expone cada
  servicio replicado sobre su propio cluster; no es un servicio aparte.
- **Punto de entrada.** El cliente puede llamar a cada servicio directamente o a través de un
  gateway. La decisión queda para la Parte 3 (comunicaciones y diagrama) y no altera las
  fichas.

---

## 4.2 Fichas de cada microservicio

### Servicio: Catálogo

| Elemento | Definición |
|---|---|
| **Nombre** | Servicio de Catálogo (`catalogo-service`) |
| **Responsabilidad principal** | Definir qué productos se ofrecen, con qué nombre, en qué categoría y a qué precio. |
| **Operaciones** | Dar de alta un producto · Modificar nombre, categoría o precio · Dar de baja un producto · Consultar un producto · Buscar por texto en el nombre y por categoría. |
| **Reglas de negocio** | Nombre obligatorio y sin espacios sobrantes (R1) · Nombre único (R2) · Precio mayor a 0 (R3) · Categoría ∈ {`periferico`, `monitor`, `accesorio`, `otro`}, por defecto `otro` (R5). |
| **Datos propios** | Producto: `id`, `nombre`, `precio`, `categoria`, `createdAt`, `updatedAt`, `version`. **Ya no incluye `stock`.** |
| **Endpoints** | *Migran:* `GET /api/productos` (filtros `nombreContiene`, `categoria`), `GET /api/productos/:id`, `POST /api/productos` (sin `stock`), `PUT /api/productos/:id` (solo `nombre`, `precio`, `categoria`), `DELETE /api/productos/:id`. *Nuevos:* ninguno. |
| **Dependencias** | Ninguna. Otros servicios lo consultan, él no consulta a nadie. |
| **Fuera de alcance** | Cuántas unidades hay y si alcanzan para una compra (Inventario) · Registrar compras o calcular totales (Ventas) · El precio pagado en compras pasadas: un cambio de precio **no** modifica ventas ya registradas (Ventas guarda su copia) · Borrar el stock o las ventas cuando se da de baja un producto. |
| **Justificación** | Resuelve el **Caso 1**: la oferta deja de compartir documento, `version` y log con el stock, así que un cambio de precio ya no compite con las ventas y se puede publicar un producto sin tener mercadería. Contribuye al **Caso 2**, porque el `PUT` de productos deja de aceptar `stock` y desaparece uno de los dos caminos de escritura. Todo lo que cambia junto en el grupo A (categorías, búsqueda, precios) cambia sin tocar a nadie más. |

### Servicio: Inventario

| Elemento | Definición |
|---|---|
| **Nombre** | Servicio de Inventario (`inventario-service`) |
| **Responsabilidad principal** | Ser la única autoridad sobre cuántas unidades de cada producto están disponibles y garantizar que nunca se descuente lo que no hay. |
| **Operaciones** | Consultar la disponibilidad de uno o varios productos · Registrar stock inicial o reposición (ajuste con motivo) · Descontar unidades por una venta · Consultar los movimientos de un producto. |
| **Reglas de negocio** | Stock entero y nunca negativo (R4) · Un descuento solo procede si el stock alcanza (R7) · Las operaciones sobre el stock de un mismo producto se hacen de a una (lock con TTL, R8) · Los descuentos son **relativos** y se calculan sobre el valor vigente, nunca "el stock ahora vale N" desde afuera · Todo ajuste manual registra un motivo · Un descuento con un `ventaId` ya procesado no descuenta dos veces (idempotencia ante reintentos) · Un producto sin registro de stock tiene 0 unidades disponibles. |
| **Datos propios** | Stock por producto (`productoId`, `cantidad`, `version`, `updatedAt`) · Movimientos de stock (`productoId`, `tipo`: `AJUSTE` / `DESCUENTO_VENTA`, `cantidad`, `motivo`, `ventaId`, `fecha`). |
| **Endpoints** | *Migran:* el campo `stock` de `POST /api/productos` y de `PUT /api/productos/:id` pasa a `POST /api/stock/:productoId/ajustes`; el descuento que hacía `POST /api/productos/:id/comprar` pasa a `POST /api/stock/:productoId/descuentos`. *Nuevos:* `GET /api/stock/:productoId`, `GET /api/stock?productoIds=a,b,c`, `POST /api/stock/:productoId/ajustes` `{ cantidad, motivo }`, `POST /api/stock/:productoId/descuentos` `{ cantidad, ventaId }` → 200 `{ stockRestante }` / 409 stock insuficiente, `GET /api/stock/:productoId/movimientos`. |
| **Dependencias** | Ninguna. Trata `productoId` como un identificador opaco: no consulta a Catálogo para decidir. |
| **Fuera de alcance** | Nombre, precio y categoría del producto (Catálogo) · Validar que el producto se siga ofreciendo antes de vender (lo verifica Ventas) · Calcular totales o guardar ventas (Ventas) · Decidir si una venta se cancela: solo ejecuta lo que se le pide. |
| **Justificación** | Resuelve el **Caso 2**: pasa a haber un solo escritor del stock, el lock vive donde vive el dato, y el descuento relativo elimina la pérdida de actualizaciones reproducida (reposición a 50 + compra de 2 → 48, no 8). Resuelve la mitad de stock del **Caso 1** y la regla R7 del **Caso 3**. Es el servicio que más necesita consistencia fuerte, así que es el que se despliega primero sobre el módulo Raft (**Caso 4**), con una State Machine que solo conoce `AJUSTE` y `DESCUENTO`. Puede evolucionar (reservas, varios depósitos, stock mínimo) sin cambiar su contrato. |

### Servicio: Ventas

| Elemento | Definición |
|---|---|
| **Nombre** | Servicio de Ventas (`ventas-service`) |
| **Responsabilidad principal** | Concretar la compra de un cliente y dejar constancia de qué se vendió, cuánto y a qué precio. |
| **Operaciones** | Registrar una compra (coordina la verificación del producto y el descuento de unidades) · Consultar una venta · Listar ventas. |
| **Reglas de negocio** | Cantidad entera y mayor a 0 (R6) · Solo se vende un producto que existe en el Catálogo · El precio unitario se toma del Catálogo **al momento de la compra** y queda congelado en la venta · Total = precio unitario × cantidad · Una venta solo queda `CONFIRMADA` si Inventario confirmó el descuento; si Inventario responde stock insuficiente no se descuenta nada y la venta se rechaza · Cada venta tiene un `ventaId` propio que se usa como clave de idempotencia ante Inventario. |
| **Datos propios** | Venta: `id`, `productoId`, `nombreProducto` (copia), `precioUnitario` (copia), `cantidad`, `total`, `estado` (`CONFIRMADA` / `RECHAZADA`), `fecha`. Las copias de nombre y precio son intencionales: describen la venta como fue, aunque el catálogo cambie después. |
| **Endpoints** | *Migran:* `POST /api/productos/:id/comprar` `{ cantidad }` → `POST /api/ventas` `{ productoId, cantidad }`. *Nuevos:* `GET /api/ventas`, `GET /api/ventas/:id`. |
| **Dependencias** | **Catálogo**: `GET /api/productos/:id`, para saber si existe y su precio vigente. **Inventario**: `POST /api/stock/:productoId/descuentos`, para descontar las unidades. |
| **Fuera de alcance** | Decidir si hay stock suficiente: lo pregunta, no lo calcula (Inventario) · Tomar locks o tocar Redis · Modificar precios o productos (Catálogo) · Reponer stock. |
| **Justificación** | Resuelve el **Caso 3**: la compra deja de ser una función que valida, bloquea, decide el stock y arma comandos de consenso; Ventas solo coordina y registra, y cada decisión queda en su dueño. Agrega el dato que hoy falta (no hay historial ni precio al momento de la compra), que es una responsabilidad nueva con reglas propias (precio congelado, total, estados) y no una tabla inventada. Sus dependencias van en un solo sentido: ni Catálogo ni Inventario saben que Ventas existe. |

---

## 4.3 Tabla general de responsabilidades

| Microservicio | Responsabilidad | Datos administrados | Funciones principales | Dependencias |
|---|---|---|---|---|
| Catálogo | Definir qué se ofrece y a qué precio | Productos (nombre, precio, categoría) | Alta, modificación, baja, consulta y búsqueda de productos | Ninguna |
| Inventario | Controlar las unidades disponibles y que nunca se vendan de más | Stock por producto, movimientos de stock | Consultar disponibilidad, ajustar con motivo, descontar por venta, ver movimientos | Ninguna |
| Ventas | Concretar compras y registrar qué se vendió | Ventas (con nombre y precio al momento de la compra) | Registrar compra, consultar y listar ventas | Catálogo (existencia y precio), Inventario (descuento) |

Las dependencias forman un árbol sin ciclos: **Ventas → Catálogo** y **Ventas → Inventario**.
Catálogo e Inventario no se conocen entre sí.

## 4.4 Funcionalidades que cambian de lugar

Cada endpoint del sistema actual tiene destino. Esta tabla es la guía para migrar el código
en el TP6.

| Endpoint actual (TP4) | Servicio destino | Endpoint propuesto | Cambio |
|---|---|---|---|
| `GET /api/productos` | Catálogo | `GET /api/productos` | Ya no devuelve `stock`. Para mostrar disponibilidad: `GET /api/stock?productoIds=…` en Inventario. |
| `GET /api/productos/:id` | Catálogo | `GET /api/productos/:id` | Ya no devuelve `stock`. |
| `POST /api/productos` | Catálogo + Inventario | `POST /api/productos` (sin `stock`) y luego `POST /api/stock/:productoId/ajustes` `{ cantidad, motivo: "stock inicial" }` | Se separa en dos pasos. Mientras no se carga el stock, el producto existe pero tiene 0 disponibles: no se vende de más. |
| `PUT /api/productos/:id` | Catálogo (nombre, precio, categoría) / Inventario (stock) | `PUT /api/productos/:id` · `POST /api/stock/:productoId/ajustes` | El `PUT` deja de aceptar `stock`. Los ajustes de stock llevan motivo y pasan por el lock (Caso 2). |
| `DELETE /api/productos/:id` | Catálogo | `DELETE /api/productos/:id` | No borra stock ni ventas. Ventas rechaza compras de productos que ya no están en el Catálogo. |
| `POST /api/productos/:id/comprar` | Ventas | `POST /api/ventas` `{ productoId, cantidad }` | Pasa a crear una venta registrada; el descuento lo hace Inventario. |
| — | Inventario | `GET /api/stock/:productoId`, `GET /api/stock?productoIds=…`, `GET /api/stock/:productoId/movimientos`, `POST /api/stock/:productoId/descuentos` | Nuevos. |
| — | Ventas | `GET /api/ventas`, `GET /api/ventas/:id` | Nuevos. |
| `GET /api/cluster/estado`, `GET /api/cluster/log` | Cada servicio replicado | Mismos paths, sobre su propio cluster | Diagnóstico, no negocio. |
| `POST /raft/request-vote`, `POST /raft/append-entries`, `GET /raft/estado` | Módulo Raft dentro de cada servicio replicado | Mismos paths, puerto interno | Infraestructura; no forman parte de la API pública. |
| `/api-docs` | Cada servicio | `/api-docs` | Cada servicio documenta solo su propia API. |

## 4.5 Para la Parte 3 (datos, comunicaciones y diagrama)

Resumen de lo que las matrices y el diagrama tienen que respetar:

- **Servicios:** Catálogo (`catalogo-service`), Inventario (`inventario-service`), Ventas
  (`ventas-service`). Raft y Redis no son servicios.
- **Propiedad de datos:** Producto → Catálogo · Stock y Movimientos → Inventario · Venta →
  Ventas. Nadie escribe datos de otro; Ventas guarda una **copia** de nombre y precio a
  propósito.
- **Comunicaciones necesarias** (las dos únicas entre servicios):
  1. Ventas → Catálogo: `GET /api/productos/:id`, para obtener existencia y precio.
  2. Ventas → Inventario: `POST /api/stock/:productoId/descuentos` `{ cantidad, ventaId }`
     → 200 `{ stockRestante }` / 409.
- **Casos de uso sugeridos para trazar:** "registrar una compra" (pasa por los tres
  servicios) y "reponer stock" o "cambiar el precio de un producto" (un solo servicio, para
  mostrar que no requiere coordinación).
- **Pregunta abierta para la matriz de comunicaciones:** qué hace Ventas si Inventario no
  responde. Propuesta: responder 503 y no registrar la venta como confirmada; el `ventaId`
  permite reintentar sin descontar dos veces.
