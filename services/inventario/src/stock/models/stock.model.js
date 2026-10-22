const mongoose = require('mongoose');

// Cantidad disponible por producto. productoId es una referencia lógica a Catálogo
// (TP5 §5.1): se guarda el id, nunca se lee la base de Catálogo.
// Solo la State Machine escribe esta colección.
const stockSchema = new mongoose.Schema(
  {
    productoId: { type: String, required: true, unique: true },
    cantidad: { type: Number, required: true, min: 0 },
    // Índice de la última entrada Raft que tocó este documento: hace idempotente la
    // re-aplicación de una entrada si el nodo se cayó a mitad de camino.
    ultimoIndiceRaft: { type: Number, default: 0 },
    updatedAt: { type: Date },
  },
  { collection: 'stock', versionKey: false }
);

const Stock = mongoose.model('Stock', stockSchema);

module.exports = { Stock };
