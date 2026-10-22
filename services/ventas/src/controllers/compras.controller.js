const comprasService = require('../services/comprasService');

// Los controllers solo traducen HTTP ↔ servicio. Los errores (400, 404, 409, 502, 503)
// los lanza la capa de servicios y los responde el manejador de errores de app.js.

async function obtenerCompra(req, res) {
  const compra = await comprasService.obtenerCompra(req.params.id);
  res.status(200).json(compra);
}

module.exports = { obtenerCompra };
