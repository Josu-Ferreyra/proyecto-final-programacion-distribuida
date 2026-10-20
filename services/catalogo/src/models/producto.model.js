const mongoose = require('mongoose');
const { CATEGORIAS, CATEGORIA_POR_DEFECTO } = require('./categorias');

// Producto del catálogo. A diferencia del TP4 ya no guarda `stock` (es de Inventario)
// ni `version` / `ultimoIndiceRaft` (Catálogo no se replica con Raft): lo escribe
// directamente el servicio, así que los timestamps los genera Mongoose.
const productoSchema = new mongoose.Schema(
  {
    // R1 obligatorio y sin espacios sobrantes · R2 único
    nombre: {
      type: String,
      required: [true, 'El nombre es obligatorio'],
      trim: true,
      unique: true,
    },
    // R3 mayor a 0
    precio: {
      type: Number,
      required: [true, 'El precio es obligatorio'],
      validate: {
        validator: (valor) => Number.isFinite(valor) && valor > 0,
        message: 'El precio debe ser un número mayor a 0',
      },
    },
    // R5 categoría válida, por defecto "otro"
    categoria: {
      type: String,
      enum: {
        values: CATEGORIAS,
        message: `La categoría debe ser una de: ${CATEGORIAS.join(', ')}`,
      },
      default: CATEGORIA_POR_DEFECTO,
    },
    // Baja lógica: un producto dado de baja no se borra, porque Inventario y Ventas
    // guardan su id (docs/05-propiedad-datos.md §5.1). Ventas no vende inactivos.
    activo: {
      type: Boolean,
      default: true,
    },
  },
  {
    timestamps: true,
    // El contrato (C1, C4) usa "id", no "_id".
    toJSON: {
      versionKey: false,
      transform: (_doc, { _id, ...resto }) => ({ id: _id.toString(), ...resto }),
    },
  }
);

const Producto = mongoose.model('Producto', productoSchema);

module.exports = { Producto };
