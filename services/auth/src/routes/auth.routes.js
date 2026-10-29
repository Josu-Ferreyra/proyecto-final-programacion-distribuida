const express = require('express');
const { registrar, login, yo } = require('../controllers/auth.controller');

// Acceso según la matriz de docs/14-modelo-seguridad.md:
//   POST /auth/register   público (siempre crea CLIENTE)
//   POST /auth/login      público
//   GET  /auth/me         cualquier usuario autenticado
// La documentación de cada una está en src/config/swagger.js.
function crearAuthRouter({ autenticar }) {
  const router = express.Router();

  router.post('/register', registrar);
  router.post('/login', login);
  router.get('/me', autenticar, yo);

  return router;
}

module.exports = { crearAuthRouter };
