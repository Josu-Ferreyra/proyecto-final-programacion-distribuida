const express = require('express');
const { crearUsuario, cambiarActivo } = require('../controllers/usuarios.controller');

// Administración de usuarios: solo ADMIN (matriz de docs/14-modelo-seguridad.md).
//   POST  /auth/usuarios        alta de otro ADMIN o CLIENTE
//   PATCH /auth/usuarios/:id    habilitar o deshabilitar una cuenta
function crearUsuariosRouter({ autenticar, requerirRol }) {
  const router = express.Router();

  router.use(autenticar, requerirRol('ADMIN'));
  router.post('/', crearUsuario);
  router.patch('/:id', cambiarActivo);

  return router;
}

module.exports = { crearUsuariosRouter };
