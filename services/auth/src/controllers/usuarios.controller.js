const usuariosService = require('../services/usuarios.service');

// Altas y bajas administradas (solo ADMIN, lo exige usuarios.routes.js). El id del administrador
// queda en el log de cada operación.

async function crearUsuario(req, res) {
  const { email, password, rol } = req.body || {};
  const usuario = await usuariosService.crearAdministrado({ email, password, rol }, req.usuario.id);
  res.status(201).json(usuario);
}

async function cambiarActivo(req, res) {
  const usuario = await usuariosService.cambiarActivo(req.params.id, req.body || {}, req.usuario.id);
  res.status(200).json(usuario);
}

module.exports = { crearUsuario, cambiarActivo };
