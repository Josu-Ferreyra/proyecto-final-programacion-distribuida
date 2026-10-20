const productosService = require('../services/productos.service');
const logger = require('../config/logger');

// Los controllers solo traducen HTTP ↔ servicio. Los errores (400, 404, 409, 503)
// los lanza la capa de servicios y los responde el manejador de errores de app.js.

async function listarProductos(req, res) {
  const productos = await productosService.listar(req.query);
  res.status(200).json(productos);
}

async function obtenerProducto(req, res) {
  const producto = await productosService.obtener(req.params.id);
  res.status(200).json(producto);
}

async function crearProducto(req, res) {
  const producto = await productosService.crear(req.body || {});
  logger.info('Producto creado', { operacion: 'productos.crear', id: producto.id, nombre: producto.nombre });
  res.status(201).json(producto);
}

async function actualizarProducto(req, res) {
  const producto = await productosService.actualizar(req.params.id, req.body || {});
  logger.info('Producto actualizado', { operacion: 'productos.actualizar', id: producto.id });
  res.status(200).json(producto);
}

async function eliminarProducto(req, res) {
  await productosService.eliminar(req.params.id);
  logger.info('Producto dado de baja', { operacion: 'productos.baja', id: req.params.id });
  res.status(204).send();
}

module.exports = { listarProductos, obtenerProducto, crearProducto, actualizarProducto, eliminarProducto };
