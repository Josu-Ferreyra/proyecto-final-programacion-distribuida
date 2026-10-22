const express = require('express');
const { registrarCompra, obtenerCompra, cancelarCompra } = require('../controllers/compras.controller');

// Rutas sin prefijo /api, tal como están en la ficha de Ventas (decisión D4).
// La documentación de cada una está en src/config/swagger.js.
const router = express.Router();

router.post('/', registrarCompra);
router.get('/:id', obtenerCompra);
router.patch('/:id/cancelar', cancelarCompra);

module.exports = router;
