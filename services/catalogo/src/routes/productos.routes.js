const express = require('express');
const config = require('../config/env');
const logger = require('../config/logger');
const { crearAuth } = require('../middlewares/auth');
const {
  listarProductos,
  obtenerProducto,
  crearProducto,
  actualizarProducto,
  eliminarProducto,
} = require('../controllers/productos.controller');

// Rutas sin prefijo /api, tal como están en la ficha de Catálogo (decisión D4).
// La documentación de cada una está en src/config/swagger.js.
//
// Acceso según la matriz de docs/14-modelo-seguridad.md: las consultas son públicas (Ventas usa
// C1 e Inventario C4 sin token, D13) y modificar la oferta es solo de ADMIN.
const { autenticar, requerirRol } = crearAuth({ secret: config.jwtSecret, issuer: config.jwtIssuer, serviceName: config.serviceName, logger });
const router = express.Router();

router.get('/', listarProductos); // público (C1)
router.get('/:id', obtenerProducto); // público (C4)
router.post('/', autenticar, requerirRol('ADMIN'), crearProducto);
router.put('/:id', autenticar, requerirRol('ADMIN'), actualizarProducto);
router.delete('/:id', autenticar, requerirRol('ADMIN'), eliminarProducto);

module.exports = router;
