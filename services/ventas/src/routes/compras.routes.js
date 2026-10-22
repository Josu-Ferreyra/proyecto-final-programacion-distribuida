const express = require('express');
const { obtenerCompra } = require('../controllers/compras.controller');

// Rutas sin prefijo /api, tal como están en la ficha de Ventas (decisión D4).
// La documentación de cada una está en src/config/swagger.js.
const router = express.Router();

router.get('/:id', obtenerCompra);

module.exports = router;
