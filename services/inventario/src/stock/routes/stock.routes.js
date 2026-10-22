const express = require('express');

// Rutas de negocio (sin prefijo /api, D4). Las de escritura pasan por el middleware
// que las lleva al Leader del cluster.
function crearStockRouter({ controller, soloEscrituraEnLeader }) {
  const router = express.Router();

  router.get('/stock', controller.consultarStock);
  router.put('/stock/:productoId', soloEscrituraEnLeader, controller.fijarStock);

  router.post('/descuentos', soloEscrituraEnLeader, controller.crearDescuento);
  router.delete('/descuentos/:referencia', soloEscrituraEnLeader, controller.reintegrarDescuento);

  router.get('/movimientos', controller.listarMovimientos);

  return router;
}

module.exports = { crearStockRouter };
