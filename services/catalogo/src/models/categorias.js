// Única definición de las categorías válidas (regla R5). En el TP4 la lista estaba
// repetida en el modelo, la validación del listado y la especificación de Swagger
// (observación 8 de docs/01-inventario.md); ahora todos la toman de acá.
const CATEGORIAS = Object.freeze(['periferico', 'monitor', 'accesorio', 'otro']);

const CATEGORIA_POR_DEFECTO = 'otro';

module.exports = { CATEGORIAS, CATEGORIA_POR_DEFECTO };
