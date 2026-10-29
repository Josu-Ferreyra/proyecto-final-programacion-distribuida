const comprasService = require('../services/comprasService');

// Los controllers solo traducen HTTP ↔ servicio. Los errores (400, 403, 404, 409, 502, 503)
// los lanza la capa de servicios y los responde el manejador de errores de app.js.
// req.usuario = { id, rol } lo deja el middleware de autenticación: la identidad sale SIEMPRE
// del token, nunca del body.

async function registrarCompra(req, res) {
  const compra = await comprasService.registrarCompra(req.body || {}, req.usuario);
  res.status(201).json(compra);
}

async function obtenerCompra(req, res) {
  const compra = await comprasService.obtenerCompra(req.params.id, req.usuario);
  res.status(200).json(compra);
}

async function cancelarCompra(req, res) {
  const { status, cuerpo } = await comprasService.cancelarCompra(req.params.id, req.usuario);
  res.status(status).json(cuerpo);
}

module.exports = { registrarCompra, obtenerCompra, cancelarCompra };
