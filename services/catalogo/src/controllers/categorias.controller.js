const { CATEGORIAS } = require('../models/categorias');

function listarCategorias(req, res) {
  res.status(200).json(CATEGORIAS);
}

module.exports = { listarCategorias };
