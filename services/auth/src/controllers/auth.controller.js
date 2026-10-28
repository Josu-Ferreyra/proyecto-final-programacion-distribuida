const usuariosService = require('../services/usuarios.service');

// Los controllers solo traducen HTTP ↔ servicio. Los errores (400, 401, 403, 404, 409, 503)
// los lanza la capa de servicios y los responde el manejador de errores de app.js.

async function registrar(req, res) {
  const { email, password } = req.body || {};
  const usuario = await usuariosService.registrar({ email, password });
  res.status(201).json(usuario);
}

async function login(req, res) {
  const { email, password } = req.body || {};
  const token = await usuariosService.login({ email, password });
  // El token no se cachea en proxies ni en el navegador.
  res.set('Cache-Control', 'no-store');
  res.status(200).json(token);
}

async function yo(req, res) {
  const { id, email, rol, activo } = (await usuariosService.obtener(req.usuario.id)).toJSON();
  res.status(200).json({ id, email, rol, activo });
}

module.exports = { registrar, login, yo };
