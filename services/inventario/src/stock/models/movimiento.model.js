const mongoose = require('mongoose');

// Historial de cada cambio de stock. Se genera solo, al aplicar cada entrada: nadie lo
// escribe desde afuera. cantidad lleva signo (+ ingresa, - sale).
const movimientoSchema = new mongoose.Schema(
  {
    productoId: { type: String, required: true, index: true },
    tipo: { type: String, enum: ['ALTA', 'AJUSTE', 'DESCUENTO', 'REINTEGRO'], required: true },
    cantidad: { type: Number, required: true },
    stockResultante: { type: Number, required: true },
    referencia: { type: String },
    fecha: { type: Date, required: true },
    indiceRaft: { type: Number, required: true },
  },
  { collection: 'movimientos', versionKey: false }
);

// Una entrada Raft genera a lo sumo un movimiento por producto: re-aplicarla no duplica.
movimientoSchema.index({ indiceRaft: 1, productoId: 1 }, { unique: true });

const Movimiento = mongoose.model('Movimiento', movimientoSchema);

module.exports = { Movimiento };
