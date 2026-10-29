const mongoose = require('mongoose');

// Datos propios de Ventas (ficha de Ventas, TP5 §4.2 y §5.2). productoId es una
// referencia lógica a Catálogo: Ventas guarda el id, pero nunca lee la base de Catálogo.
// nombreProducto y precioUnitario son copias intencionales: describen la compra como
// fue, aunque después el producto cambie de precio, de nombre o se dé de baja.
const itemSchema = new mongoose.Schema(
  {
    productoId: { type: String, required: true },
    nombreProducto: { type: String, required: true },
    precioUnitario: { type: Number, required: true }, // "precio pagado"
    cantidad: { type: Number, required: true, min: 1 },
  },
  { _id: false }
);

const ESTADOS = Object.freeze({
  CONFIRMADA: 'CONFIRMADA',
  CANCELACION_PENDIENTE: 'CANCELACION_PENDIENTE',
  CANCELADA: 'CANCELADA',
  FALLIDA: 'FALLIDA', // D7: la compensación de un descuento no pudo confirmarse
});

// _id = compraId: lo genera Ventas ANTES de llamar a Inventario y se usa como
// referencia del descuento (C2) y del reintegro (C3).
const compraSchema = new mongoose.Schema(
  {
    // Dueño de la compra (TP7 §11.2): el sub del token del cliente. Es una referencia lógica a
    // un usuario de auth-service; Ventas guarda el id y nunca consulta la base de usuarios.
    usuarioId: { type: String, required: true },
    estado: { type: String, enum: Object.values(ESTADOS), required: true },
    reintegroPendiente: { type: Boolean, default: false }, // D7
    items: { type: [itemSchema], required: true },
    total: { type: Number, required: true },
    motivoFallo: { type: String },
  },
  {
    timestamps: { createdAt: 'fecha', updatedAt: 'actualizada' },
    toJSON: {
      versionKey: false,
      transform: (_doc, { _id, ...resto }) => ({ compraId: _id.toString(), ...resto }),
    },
  }
);

// Lo usa el proceso de reintentos para encontrar los reintegros pendientes.
compraSchema.index({ estado: 1 });
compraSchema.index({ reintegroPendiente: 1 });
// Para consultar las compras de un usuario.
compraSchema.index({ usuarioId: 1 });

const Compra = mongoose.model('Compra', compraSchema);

module.exports = { Compra, ESTADOS };
