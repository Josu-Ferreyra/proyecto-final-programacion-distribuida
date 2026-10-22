const express = require('express');
const {
  listarProductos,
  obtenerProducto,
  crearProducto,
  actualizarProducto,
  eliminarProducto,
} = require('../controllers/productos.controller');

// Rutas sin prefijo /api, tal como están en la ficha de Catálogo (decisión D4).
// La documentación de cada una está en src/config/swagger.js.
const router = express.Router();

router.get('/', listarProductos);
router.get('/:id', obtenerProducto);
router.post('/', crearProducto);
router.put('/:id', actualizarProducto);
router.delete('/:id', eliminarProducto);

module.exports = router;
