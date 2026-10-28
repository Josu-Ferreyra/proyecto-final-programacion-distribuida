const express = require('express');
const config = require('../config/env');

// Indica que el proceso está vivo. No consulta la base ni expone URIs: lo usa el
// healthcheck de Docker Compose.
const router = express.Router();

router.get('/', (req, res) => {
  res.status(200).json({ service: config.serviceName, status: 'ok' });
});

module.exports = router;
