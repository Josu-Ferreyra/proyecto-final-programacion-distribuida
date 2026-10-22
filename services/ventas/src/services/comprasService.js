const mongoose = require('mongoose');
const { Compra } = require('../models/compra.model');
const { ErrorNegocio } = require('../errors');

// Reglas de negocio de Ventas (ficha de Ventas, TP5 §4.2): concretar las compras y
// llevar su ciclo de vida. Ventas no conoce el stock, ni Raft, ni el lock de Redis.

function validarCompraId(id) {
  if (!mongoose.Types.ObjectId.isValid(id)) {
    throw new ErrorNegocio(400, 'El id de la compra debe ser un ObjectId de MongoDB válido');
  }
}

// GET /compras/:id: lee solo la base propia; no llama a nadie (TP5 §5.2).
async function obtenerCompra(id) {
  validarCompraId(id);
  const compra = await Compra.findById(id);
  if (!compra) throw new ErrorNegocio(404, `Compra con id ${id} no encontrada`);
  return compra;
}

module.exports = { obtenerCompra };
