const express = require('express');
const {
  listarProductos,
  obtenerProductoPorId,
  crearProducto,
  actualizarProducto,
  eliminarProducto,
  comprarProducto,
} = require('../controllers/productos.controller');
const { soloLeader } = require('../middlewares/soloLeader');

const router = express.Router();

/**
 * @openapi
 * /api/productos:
 *   get:
 *     summary: Listar productos (lectura local del nodo que atiende)
 *     tags: [Productos]
 *     parameters:
 *       - in: query
 *         name: nombreContiene
 *         schema: { type: string }
 *         description: Filtra por productos cuyo nombre contiene este texto (case-insensitive)
 *       - in: query
 *         name: categoria
 *         schema: { type: string, enum: [periferico, monitor, accesorio, otro] }
 *         description: Filtra por categoría exacta
 *     responses:
 *       200:
 *         description: Listado de productos
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items: { $ref: '#/components/schemas/Producto' }
 *       400: { $ref: '#/components/responses/BadRequest' }
 */
router.get('/', listarProductos);

/**
 * @openapi
 * /api/productos/{id}:
 *   get:
 *     summary: Consultar un producto por id (lectura local)
 *     tags: [Productos]
 *     parameters:
 *       - $ref: '#/components/parameters/ProductoId'
 *     responses:
 *       200:
 *         description: Producto encontrado
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/Producto' }
 *       400: { $ref: '#/components/responses/BadRequest' }
 *       404: { $ref: '#/components/responses/NotFound' }
 */
router.get('/:id', obtenerProductoPorId);

/**
 * @openapi
 * /api/productos:
 *   post:
 *     summary: Crear un producto (pasa por consenso Raft; solo en el Leader)
 *     tags: [Productos]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema: { $ref: '#/components/schemas/ProductoInput' }
 *           example: { nombre: "Teclado mecánico", precio: 25000, stock: 10, categoria: "periferico" }
 *     responses:
 *       201:
 *         description: Producto creado
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/Producto' }
 *       400: { $ref: '#/components/responses/BadRequest' }
 *       409: { $ref: '#/components/responses/Conflict' }
 *       421: { $ref: '#/components/responses/NoEsLeader' }
 *       503: { $ref: '#/components/responses/SinConsenso' }
 */
router.post('/', soloLeader, crearProducto);

/**
 * @openapi
 * /api/productos/{id}:
 *   put:
 *     summary: Actualizar un producto existente, parcial (pasa por consenso Raft; solo en el Leader)
 *     tags: [Productos]
 *     parameters:
 *       - $ref: '#/components/parameters/ProductoId'
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema: { $ref: '#/components/schemas/ProductoInput' }
 *           example: { precio: 27000 }
 *     responses:
 *       200:
 *         description: Producto actualizado
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/Producto' }
 *       400: { $ref: '#/components/responses/BadRequest' }
 *       404: { $ref: '#/components/responses/NotFound' }
 *       409: { $ref: '#/components/responses/Conflict' }
 *       421: { $ref: '#/components/responses/NoEsLeader' }
 *       503: { $ref: '#/components/responses/SinConsenso' }
 */
router.put('/:id', soloLeader, actualizarProducto);

/**
 * @openapi
 * /api/productos/{id}:
 *   delete:
 *     summary: Eliminar un producto (pasa por consenso Raft; solo en el Leader)
 *     tags: [Productos]
 *     parameters:
 *       - $ref: '#/components/parameters/ProductoId'
 *     responses:
 *       204: { description: Producto eliminado }
 *       400: { $ref: '#/components/responses/BadRequest' }
 *       404: { $ref: '#/components/responses/NotFound' }
 *       421: { $ref: '#/components/responses/NoEsLeader' }
 *       503: { $ref: '#/components/responses/SinConsenso' }
 */
router.delete('/:id', soloLeader, eliminarProducto);

/**
 * @openapi
 * /api/productos/{id}/comprar:
 *   post:
 *     summary: Comprar unidades (lock Redis/Memurai + consenso Raft; solo en el Leader)
 *     tags: [Productos]
 *     parameters:
 *       - $ref: '#/components/parameters/ProductoId'
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [cantidad]
 *             properties:
 *               cantidad: { type: integer, minimum: 1, example: 2 }
 *     responses:
 *       200:
 *         description: Compra realizada
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 id: { type: string }
 *                 nombre: { type: string }
 *                 comprado: { type: integer }
 *                 stockRestante: { type: integer }
 *       400: { $ref: '#/components/responses/BadRequest' }
 *       404: { $ref: '#/components/responses/NotFound' }
 *       409:
 *         description: Sin stock suficiente o recurso bloqueado por otra compra concurrente
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/Error' }
 *       421: { $ref: '#/components/responses/NoEsLeader' }
 *       503: { $ref: '#/components/responses/SinConsenso' }
 */
router.post('/:id/comprar', soloLeader, comprarProducto);

module.exports = router;
