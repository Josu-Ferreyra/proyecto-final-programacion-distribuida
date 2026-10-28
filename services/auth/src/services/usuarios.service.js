const bcrypt = require('bcryptjs');
const mongoose = require('mongoose');
const config = require('../config/env');
const logger = require('../config/logger');
const { Usuario } = require('../models/usuario.model');
const { emitirToken } = require('./tokens');
const { solicitudInvalida, noAutorizado, prohibido, noEncontrado, conflicto } = require('./errores');

// Identidad (TP7 §5 a §8): registro, login y altas administradas. auth-service no conoce
// productos, stock ni compras: solo quién es cada usuario y qué rol tiene (D8).

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PASSWORD_MIN = 8;
// bcrypt solo usa los primeros 72 bytes: una password más larga se rechaza en lugar de truncarla
// en silencio (si no, dos passwords distintas con el mismo comienzo serían la misma).
const PASSWORD_MAX_BYTES = 72;
const ROLES_ADMINISTRABLES = ['CLIENTE', 'ADMIN'];

// Hash con el mismo costo que los reales, para comparar aunque el usuario no exista.
const HASH_FICTICIO = bcrypt.hashSync('no-es-una-password-real', config.bcryptRounds);

// 's***@uch.edu.ar': el log de un login fallido no guarda el email completo.
function enmascarar(email) {
  if (typeof email !== 'string') return undefined;
  const [usuario, dominio] = email.trim().toLowerCase().split('@');
  return dominio === undefined ? '***' : `${usuario.slice(0, 1)}***@${dominio}`;
}

function validarEmail(email) {
  if (typeof email !== 'string' || email.length > 254 || !EMAIL.test(email.trim())) {
    throw solicitudInvalida('El email es obligatorio y debe tener un formato válido');
  }
}

function validarPasswordNueva(password) {
  if (typeof password !== 'string' || password.length < PASSWORD_MIN || Buffer.byteLength(password) > PASSWORD_MAX_BYTES) {
    throw solicitudInvalida(`La password es obligatoria y debe tener entre ${PASSWORD_MIN} y ${PASSWORD_MAX_BYTES} caracteres`);
  }
}

// En el login no se exige el largo mínimo (no aporta nada y un 400 distinto del 401 solo
// confunde), pero sí el máximo: es lo que evita el truncamiento de bcrypt.
function validarCredenciales(email, password) {
  validarEmail(email);
  if (typeof password !== 'string' || password.length === 0) throw solicitudInvalida('La password es obligatoria');
  if (Buffer.byteLength(password) > PASSWORD_MAX_BYTES) {
    throw solicitudInvalida(`La password no puede tener más de ${PASSWORD_MAX_BYTES} caracteres`);
  }
}

function validarId(id) {
  if (!mongoose.Types.ObjectId.isValid(id)) throw solicitudInvalida('El id debe ser un ObjectId de MongoDB válido');
}

// Alta común a register, POST /auth/usuarios y el bootstrap. El chequeo previo no cubre dos
// altas simultáneas con el mismo email: en ese caso el índice único rechaza la segunda (E11000).
async function crear({ email, password, rol }) {
  validarEmail(email);
  validarPasswordNueva(password);
  const normalizado = email.trim().toLowerCase();
  if (await Usuario.exists({ email: normalizado })) throw conflicto('El email ya está registrado');
  const passwordHash = await bcrypt.hash(password, config.bcryptRounds);
  try {
    return await Usuario.create({ email: normalizado, passwordHash, rol });
  } catch (err) {
    if (err.code === 11000) throw conflicto('El email ya está registrado');
    throw err;
  }
}

// POST /auth/register: siempre CLIENTE. Si el body trae "rol", se ignora (D11): nadie se
// auto-asigna ADMIN.
async function registrar({ email, password }) {
  const usuario = await crear({ email, password, rol: 'CLIENTE' });
  logger.info('Usuario registrado', { operacion: 'registro', usuarioId: usuario.id, rol: usuario.rol });
  return usuario;
}

async function login({ email, password }) {
  validarCredenciales(email, password);
  const usuario = await Usuario.findOne({ email: email.trim().toLowerCase() });
  // Comparar SIEMPRE, aunque el usuario no exista: si no, se puede adivinar qué emails existen
  // por cuánto tarda la respuesta.
  const ok = await bcrypt.compare(password, usuario ? usuario.passwordHash : HASH_FICTICIO);
  if (!usuario || !ok) {
    logger.warn('Login fallido', {
      operacion: 'login',
      motivo: usuario ? 'password incorrecta' : 'usuario inexistente',
      email: enmascarar(email),
    });
    throw noAutorizado('Credenciales inválidas');
  }
  // D12: recién después de validar la password, así este 403 no revela si el email existe.
  if (!usuario.activo) {
    logger.warn('Login rechazado', { operacion: 'login', motivo: 'cuenta deshabilitada', usuarioId: usuario.id });
    throw prohibido('Cuenta deshabilitada');
  }
  logger.info('Login exitoso', { operacion: 'login', usuarioId: usuario.id, rol: usuario.rol });
  return emitirToken(usuario);
}

// GET /auth/me. El token puede ser válido y el usuario no existir (por ejemplo, uno generado
// con scripts/token.js con un sub inventado): 404.
async function obtener(id) {
  const usuario = mongoose.Types.ObjectId.isValid(id) ? await Usuario.findById(id) : null;
  if (!usuario) throw noEncontrado('El usuario del token no existe');
  return usuario;
}

// POST /auth/usuarios (solo ADMIN). Las cuentas SERVICIO no se crean por acá: solo la de Ventas,
// al arrancar (D11).
async function crearAdministrado({ email, password, rol }, adminId) {
  if (!ROLES_ADMINISTRABLES.includes(rol)) {
    throw solicitudInvalida(`El rol debe ser uno de: ${ROLES_ADMINISTRABLES.join(', ')}`);
  }
  const usuario = await crear({ email, password, rol });
  logger.info('Usuario creado por un administrador', { operacion: 'usuarios.crear', usuarioId: usuario.id, rol, adminId });
  return usuario;
}

// PATCH /auth/usuarios/:id (solo ADMIN). Solo cambia "activo": el rol, el email y la password no
// se modifican por acá. Los tokens ya emitidos siguen valiendo hasta su exp (D12).
async function cambiarActivo(id, body, adminId) {
  validarId(id);
  const campos = Object.keys(body);
  if (campos.length !== 1 || campos[0] !== 'activo' || typeof body.activo !== 'boolean') {
    throw solicitudInvalida('El body debe ser { "activo": true } o { "activo": false }');
  }
  if (id === adminId && body.activo === false) {
    throw solicitudInvalida('Un administrador no puede deshabilitar su propia cuenta');
  }
  const usuario = await Usuario.findByIdAndUpdate(id, { activo: body.activo }, { new: true });
  if (!usuario) throw noEncontrado(`Usuario con id ${id} no encontrado`);
  logger.info(body.activo ? 'Cuenta habilitada' : 'Cuenta deshabilitada', {
    operacion: 'usuarios.activo',
    usuarioId: usuario.id,
    adminId,
  });
  return usuario;
}

module.exports = { crear, registrar, login, obtener, crearAdministrado, cambiarActivo, enmascarar };
