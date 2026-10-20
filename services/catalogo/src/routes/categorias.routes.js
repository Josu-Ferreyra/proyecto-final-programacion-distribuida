const express = require('express');
const { listarCategorias } = require('../controllers/categorias.controller');

// No consulta la base: las categorías son parte del código del servicio.
const router = express.Router();

router.get('/', listarCategorias);

module.exports = router;
