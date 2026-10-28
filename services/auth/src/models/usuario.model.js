const mongoose = require('mongoose');

// Roles del sistema (D10). Un solo rol por usuario; viaja en el claim "role" del token.
const ROLES = ['CLIENTE', 'ADMIN', 'SERVICIO'];

// Usuario de auth-service (TP7 §6). Es el único lugar del sistema con credenciales: los demás
// servicios solo conocen el id (el "sub" del token) y el rol.
const usuarioSchema = new mongoose.Schema(
  {
    // Dato de login. Se guarda sin espacios y en minúsculas, así "Ana@X.com" y "ana@x.com" son
    // el mismo usuario. El formato lo valida usuarios.service.js antes de llegar acá.
    email: {
      type: String,
      required: true,
      trim: true,
      lowercase: true,
      unique: true,
    },
    // bcrypt(password, BCRYPT_ROUNDS). La password nunca se guarda.
    passwordHash: {
      type: String,
      required: true,
    },
    rol: {
      type: String,
      enum: ROLES,
      required: true,
    },
    // D12: una cuenta deshabilitada no puede hacer login.
    activo: {
      type: Boolean,
      default: true,
    },
  },
  {
    timestamps: true,
    // Lista blanca de campos: el hash no sale en ninguna respuesta aunque alguien devuelva el
    // documento entero por error.
    toJSON: {
      transform: (doc) => ({
        id: doc._id.toString(),
        email: doc.email,
        rol: doc.rol,
        activo: doc.activo,
        createdAt: doc.createdAt,
      }),
    },
  }
);

const Usuario = mongoose.model('Usuario', usuarioSchema, 'usuarios');

module.exports = { Usuario, ROLES };
