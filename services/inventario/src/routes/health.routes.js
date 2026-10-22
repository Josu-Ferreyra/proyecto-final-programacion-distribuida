const express = require('express');

// Indica que el proceso está vivo. No consulta la base ni expone URIs ni configuración:
// lo usa el healthcheck de Docker Compose.
function crearHealthRouter({ serviceName, nodoId }) {
  const router = express.Router();
  router.get('/', (req, res) => {
    res.status(200).json({ service: serviceName, nodo: nodoId, status: 'ok' });
  });
  return router;
}

module.exports = { crearHealthRouter };
