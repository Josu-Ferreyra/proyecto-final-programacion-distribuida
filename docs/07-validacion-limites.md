# 7. Validación de los límites propuestos

> Corresponde a la sección 12 del TP (entregable 16).

Revisado por: _Integrante 1, Integrante 2, Integrante 3_ — fecha: _AAAA-MM-DD_

> **Estado: borrador para la sesión de validación.** Los valores los completó previamente
> la Parte 3 como punto de partida. En la sesión el grupo revisa cada celda, servicio por
> servicio, y corrige lo que haga falta. Recién ahí se completan la fecha y los nombres.

| Criterio | Catálogo | Inventario | Ventas |
|---|---|---|---|
| Su responsabilidad principal se explica en una frase clara | ✅ | ✅ | ✅ |
| Agrupa reglas de negocio relacionadas entre sí | ✅ | ✅ | ✅ |
| Posee un conjunto de datos o decisiones de los que es responsable | ✅ | ✅ | ✅ |
| No fue creado solo porque existe una tabla, entidad o controlador | ⚠️ | ✅ | ✅ |
| Su interfaz pública se define sin exponer detalles internos | ✅ | ✅ | ✅ |
| Puede modificarse internamente sin cambios simultáneos en los demás | ✅ | ✅ | ✅ |
| No duplica reglas cuya autoridad pertenece a otro servicio | ✅ | ✅ | ⚠️ |
| Sus dependencias son necesarias y están justificadas | ✅ | ⚠️ | ✅ |
| El grupo puede explicar qué queda fuera del servicio | ✅ | ✅ | ✅ |

Leyenda: ✅ cumple · ⚠️ cumple con observaciones · ❌ no cumple

## 7.1 Observaciones por servicio

**Catálogo — "No fue creado solo porque existe una tabla" (⚠️).**
Catálogo se parece mucho a la colección `productos` actual sin el campo `stock`, así que es
razonable preguntarse si es solo "el servicio de la tabla productos". Se considera que
cumple porque tiene reglas propias, que no dependen de ningún otro servicio: el nombre es
único, el precio es mayor que 0, la categoría es válida y un producto dado de baja no se
borra. También tiene un ritmo de cambio propio: los precios y las categorías los cambia la
administración, no las ventas. Queda como ⚠️ para que el grupo lo pueda defender en la
presentación.

**Inventario — "Sus dependencias son necesarias" (⚠️).**
La dependencia C4 (Inventario → Catálogo al dar de alta stock) es la menos obvia. Se
evaluaron dos alternativas:

1. Sin C4: Inventario acepta cualquier `productoId`. Elimina la dependencia, pero permite
   tener stock de productos inexistentes por un error de tipeo.
2. Catálogo → Inventario al crear el producto, para crear el stock en 0. Invierte la
   dependencia y hace que el alta de producto falle si Inventario está caído.

Se mantiene C4 porque se usa solo en el alta (no en compras ni ajustes) y porque su falla
deja un estado válido (producto sin stock). Si en la implementación molesta, la
alternativa 1 es la salida más simple.

**Ventas — "No duplica reglas" (⚠️).**
Ventas valida que `cantidad` sea un entero mayor que 0, e Inventario también lo valida en
`POST /descuentos`. Se considera validación del formato de cada contrato, no una regla de
negocio duplicada: la regla real ("no vender más de lo que hay") la decide solo
Inventario. Hay que asegurarse de que Ventas **no** consulte el stock antes de pedir el
descuento (ver 6.1).

## 7.2 Revisión de la separación

El TP pide revisar si dos servicios comparten continuamente datos internos, modifican las
mismas entidades o coordinan casi todas sus operaciones.

| Par de servicios | ¿Comparten datos internos? | ¿Modifican las mismas entidades? | ¿Coordinan casi todo? | Conclusión |
|---|---|---|---|---|
| Catálogo – Inventario | No. Inventario solo guarda el `productoId` como referencia | No. Catálogo ya no escribe el stock | No. Solo en el alta de stock (C4) | Separación adecuada |
| Catálogo – Ventas | No. Ventas guarda una **copia propia** del precio y del nombre, no los de Catálogo | No | No. Solo al crear una compra (C1) | Separación adecuada |
| Inventario – Ventas | No. Ventas solo conoce su `compraId` como referencia del descuento | No. Ventas pide; Inventario modifica el stock | Coordinan en **cada compra y cada cancelación**, pero no en consultas, altas ni ajustes de stock | Separación adecuada, con observación: es el par más acoplado. Si en la implementación aparecieran más operaciones que necesitan a los dos a la vez, revisar el límite |

Ningún par de servicios se llama en los dos sentidos (ver [diagrama](./diagrama-arquitectura.md)).

## 7.3 Acciones derivadas

Cosas que la revisión de la Parte 3 encontró que deben reflejarse en otros documentos. Se
confirman o descartan en la sesión.

| Observación | Acción | PR donde se corrigió |
|---|---|---|
| Ventas necesita consultar varios productos en una sola llamada | Agregar `GET /productos?ids=…` a los endpoints de la ficha de Catálogo | _pendiente_ |
| Las categorías hoy son un enum en el código | Agregar `GET /categorias` a la ficha de Catálogo | _pendiente_ |
| `DELETE /api/productos/:id` borra el documento y deja referencias huérfanas | Ficha de Catálogo: el `DELETE` pasa a ser baja lógica (`activo = false`) | _pendiente_ |
| `PUT /api/productos/:id` acepta `stock` | Ficha de Catálogo: `stock` queda fuera de alcance; el ajuste es `PUT /stock/:productoId` en Inventario | _pendiente_ |
| El lock Redis está en el controller de productos | Ficha de Inventario: el lock se menciona como detalle interno, no en la interfaz | _pendiente_ |
| Dependencia Inventario → Catálogo (C4) | Confirmar que figure en "Dependencias" de la ficha de Inventario, o eliminar C4 (alternativa 1) en todos los documentos | _pendiente_ |
| Completar los ☐ del control de coherencia del diagrama | Contrastar con las fichas finales | _pendiente_ |
