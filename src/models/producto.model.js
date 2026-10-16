const mongoose = require('mongoose');

const CATEGORIAS = ['periferico', 'monitor', 'accesorio', 'otro'];

// En el TP4 este modelo solo lo escribe la State Machine (src/raft/stateMachine.js),
// nunca un controller directamente. Por eso los timestamps no los genera Mongoose
// (serían distintos en cada réplica): vienen dentro del comando Raft, fijados una
// sola vez por el Leader. version y ultimoIndiceRaft permiten comparar réplicas.
const productoSchema = new mongoose.Schema(
  {
    nombre: {
      type: String,
      required: [true, 'El nombre es obligatorio'],
      trim: true,
      unique: true,
      minlength: [1, 'El nombre no puede estar vacío'],
    },
    precio: {
      type: Number,
      required: [true, 'El precio es obligatorio'],
      min: [0.01, 'El precio debe ser mayor a 0'],
    },
    stock: {
      type: Number,
      required: [true, 'El stock es obligatorio'],
      min: [0, 'El stock no puede ser negativo'],
      validate: {
        validator: Number.isInteger,
        message: 'El stock debe ser un número entero',
      },
    },
    categoria: {
      type: String,
      enum: {
        values: CATEGORIAS,
        message: `La categoría debe ser una de: ${CATEGORIAS.join(', ')}`,
      },
      default: 'otro',
    },
    // Cantidad de modificaciones aplicadas (1 al crearse).
    version: { type: Number, default: 1 },
    // Índice de la última entrada del log Raft que modificó este documento.
    // También hace idempotente la re-aplicación de una entrada tras un reinicio.
    ultimoIndiceRaft: { type: Number, default: 0 },
    createdAt: { type: Date },
    updatedAt: { type: Date },
  },
  {
    toJSON: {
      virtuals: true,
      versionKey: false,
      transform: (_doc, ret) => {
        delete ret._id;
        return ret;
      },
    },
  }
);

productoSchema.virtual('id').get(function idVirtual() {
  return this._id.toString();
});

const Producto = mongoose.model('Producto', productoSchema);

module.exports = { Producto, CATEGORIAS };
