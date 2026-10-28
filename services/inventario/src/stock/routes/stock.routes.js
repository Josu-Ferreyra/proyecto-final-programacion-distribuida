const express = require('express');

// Rutas de negocio (sin prefijo /api, D4). Acceso según la matriz de docs/14-modelo-seguridad.md:
//   GET  /stock                       público
//   PUT  /stock/:productoId           ADMIN
//   POST /descuentos (C2)             SERVICIO o ADMIN (un CLIENTE no mueve stock: D13)
//   DELETE /descuentos/:ref (C3)      SERVICIO o ADMIN
//   GET  /movimientos                 ADMIN
//
// autenticar y requerirRol van ANTES de soloEscrituraEnLeader: un follower rechaza con 401/403
// sin reenviar nada al Leader, y lo que sí se reenvía lleva el Authorization original.
function crearStockRouter({ controller, soloEscrituraEnLeader, auth }) {
  const { autenticar, requerirRol } = auth;
  const router = express.Router();

  router.get('/stock', controller.consultarStock);
  router.put('/stock/:productoId', autenticar, requerirRol('ADMIN'), soloEscrituraEnLeader, controller.fijarStock);

  router.post('/descuentos', autenticar, requerirRol('SERVICIO', 'ADMIN'), soloEscrituraEnLeader, controller.crearDescuento);
  router.delete('/descuentos/:referencia', autenticar, requerirRol('SERVICIO', 'ADMIN'), soloEscrituraEnLeader, controller.reintegrarDescuento);

  router.get('/movimientos', autenticar, requerirRol('ADMIN'), controller.listarMovimientos);

  return router;
}

module.exports = { crearStockRouter };
