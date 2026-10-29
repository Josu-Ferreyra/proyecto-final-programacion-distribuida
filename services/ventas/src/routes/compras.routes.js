const express = require('express');
const config = require('../config/env');
const logger = require('../config/logger');
const { crearAuth } = require('../middlewares/auth');
const { registrarCompra, obtenerCompra, cancelarCompra } = require('../controllers/compras.controller');

// Rutas sin prefijo /api, tal como están en la ficha de Ventas (decisión D4).
// La documentación de cada una está en src/config/swagger.js.
//
// Acceso (matriz de docs/14-modelo-seguridad.md): las tres piden un token CLIENTE o ADMIN. La
// cuenta técnica SERVICIO no compra (403). Que una compra sea del usuario (regla de propiedad,
// TP7 §11.2) lo decide la capa de servicios, porque es una regla de negocio de Ventas.
const { autenticar, requerirRol } = crearAuth({
  secret: config.jwtSecret,
  issuer: config.jwtIssuer,
  serviceName: config.serviceName,
  logger,
});

const router = express.Router();

router.post('/', autenticar, requerirRol('CLIENTE', 'ADMIN'), registrarCompra);
router.get('/:id', autenticar, requerirRol('CLIENTE', 'ADMIN'), obtenerCompra);
router.patch('/:id/cancelar', autenticar, requerirRol('CLIENTE', 'ADMIN'), cancelarCompra);

module.exports = router;
