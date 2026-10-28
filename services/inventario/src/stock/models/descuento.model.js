const mongoose = require('mongoose');

// Un descuento por referencia (el compraId que genera Ventas, contratos C2 y C3).
// Guardarlo permite que repetir la misma referencia no descuente dos veces y que el
// reintegro devuelva exactamente lo descontado.
const itemSchema = new mongoose.Schema(
  {
    productoId: { type: String, required: true },
    cantidad: { type: Number, required: true },
  },
  { _id: false }
);

const descuentoSchema = new mongoose.Schema(
  {
    referencia: { type: String, required: true, unique: true },
    items: { type: [itemSchema], required: true },
    // Para quién fue la compra: el sub del cliente que manda Ventas (D13). Referencia lógica a auth-service.
    usuarioId: { type: String },
    estado: { type: String, enum: ['APLICADO', 'REINTEGRADO'], required: true },
    fecha: { type: Date, required: true },
    fechaReintegro: { type: Date },
    indiceRaft: { type: Number, required: true },
  },
  { collection: 'descuentos', versionKey: false }
);

const Descuento = mongoose.model('Descuento', descuentoSchema);

module.exports = { Descuento };
