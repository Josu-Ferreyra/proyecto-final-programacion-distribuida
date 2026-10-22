const express = require('express');
const config = require('../config/env');

// Indica que el proceso está vivo. No consulta la base ni a Catálogo o Inventario, y no
// expone URIs: lo usa el healthcheck de Docker Compose. Que una dependencia esté caída
// no vuelve "unhealthy" a Ventas: sus casos de uso responden 503, pero el proceso sigue.
const router = express.Router();

router.get('/', (req, res) => {
  res.status(200).json({ service: config.serviceName, status: 'ok' });
});

module.exports = router;
