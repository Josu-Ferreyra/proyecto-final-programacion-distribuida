const crypto = require('crypto');
const mongoose = require('mongoose');
const { Producto, CATEGORIAS } = require('../models/producto.model');
const { conectar } = require('../lib/redisClient');
const { acquireLock, releaseLock } = require('../lib/lock');
const logger = require('../lib/logger');
const { getRaft } = require('../raft/instancia');
const { TIPOS } = require('../raft/stateMachine');
const { responderErrorRaft } = require('../middlewares/soloLeader');

// Las lecturas (GET) se resuelven con la base local del nodo que atiende, sea Leader o
// follower (simplificación permitida por la consigna). Un follower puede estar un
// instante atrasado respecto del Leader.
//
// Las escrituras (POST/PUT/DELETE/comprar) NO tocan Mongo desde acá: validan, arman
// un comando completo (con id y timestamps ya fijados) y se lo proponen a Raft. La
// respuesta al cliente es el resultado de aplicar esa entrada una vez committed.

function esIdValido(id) {
  return mongoose.Types.ObjectId.isValid(id);
}

function esCantidadValida(cantidad) {
  return Number.isInteger(cantidad) && cantidad > 0;
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function mensajeDeValidacion(err) {
  return Object.values(err.errors)
    .map((e) => e.message)
    .join('; ');
}

// Propone el comando, espera commit + aplicación y traduce el resultado a HTTP.
async function ejecutarComando(res, comando) {
  let resultado;
  try {
    resultado = await getRaft().proponer(comando);
  } catch (err) {
    return responderErrorRaft(res, err);
  }

  res.set('X-Raft-Index', String(resultado.index));
  res.set('X-Raft-Term', String(resultado.term));

  if (resultado.status === 204) return res.status(204).send();
  return res.status(resultado.status).json(resultado.body);
}

async function listarProductos(req, res) {
  const { nombreContiene, categoria } = req.query;

  if (nombreContiene !== undefined && typeof nombreContiene !== 'string') {
    logger.warn('Listado de productos rechazado: nombreContiene inválido', { nombreContiene });
    return res.status(400).json({ error: 'El parámetro "nombreContiene" debe ser texto' });
  }

  if (categoria !== undefined && !CATEGORIAS.includes(categoria)) {
    logger.warn('Listado de productos rechazado: categoria inválida', { categoria });
    return res.status(400).json({ error: `El parámetro "categoria" debe ser una de: ${CATEGORIAS.join(', ')}` });
  }

  const filtro = {};
  if (nombreContiene) filtro.nombre = { $regex: nombreContiene, $options: 'i' };
  if (categoria) filtro.categoria = categoria;

  const resultado = await Producto.find(filtro).sort({ createdAt: 1 });

  logger.info('Listado de productos (lectura local)', { cantidad: resultado.length, filtro });
  res.status(200).json(resultado);
}

async function obtenerProductoPorId(req, res) {
  const { id } = req.params;

  if (!esIdValido(id)) {
    logger.warn('Consulta rechazada: id con formato inválido', { id });
    return res.status(400).json({ error: 'El id debe ser un ObjectId de MongoDB válido' });
  }

  const producto = await Producto.findById(id);

  if (!producto) {
    logger.warn('Producto no encontrado', { id });
    return res.status(404).json({ error: `Producto con id ${id} no encontrado` });
  }

  res.status(200).json(producto);
}

async function crearProducto(req, res) {
  const { nombre, precio, stock, categoria } = req.body || {};

  // Validación previa en el Leader, para no meter al log comandos que se sabe que
  // van a fallar. La State Machine vuelve a validar al aplicar (fuente de verdad).
  const borrador = new Producto({ nombre, precio, stock, categoria });
  try {
    await borrador.validate();
  } catch (err) {
    logger.warn('Creación de producto rechazada: datos inválidos', { error: mensajeDeValidacion(err) });
    return res.status(400).json({ error: mensajeDeValidacion(err) });
  }

  if (await Producto.exists({ nombre: borrador.nombre })) {
    logger.warn('Creación de producto rechazada: nombre duplicado', { nombre: borrador.nombre });
    return res.status(409).json({ error: `Ya existe un producto con el nombre "${borrador.nombre}"` });
  }

  const comando = {
    tipo: TIPOS.CREAR_PRODUCTO,
    id: new mongoose.Types.ObjectId().toString(), // generado UNA vez, igual en todas las réplicas
    datos: {
      nombre: borrador.nombre,
      precio: borrador.precio,
      stock: borrador.stock,
      categoria: borrador.categoria,
    },
    timestamp: new Date().toISOString(),
  };

  logger.info('Propongo creación de producto a Raft', { id: comando.id, nombre: comando.datos.nombre });
  return ejecutarComando(res, comando);
}

async function actualizarProducto(req, res) {
  const { id } = req.params;

  if (!esIdValido(id)) {
    logger.warn('Actualización rechazada: id con formato inválido', { id });
    return res.status(400).json({ error: 'El id debe ser un ObjectId de MongoDB válido' });
  }

  const { nombre, precio, stock, categoria } = req.body || {};

  if (nombre === undefined && precio === undefined && stock === undefined && categoria === undefined) {
    logger.warn('Actualización rechazada: sin campos', { id });
    return res.status(400).json({ error: 'Debe enviar al menos un campo para actualizar' });
  }

  const cambios = {};
  if (nombre !== undefined) cambios.nombre = nombre;
  if (precio !== undefined) cambios.precio = precio;
  if (stock !== undefined) cambios.stock = stock;
  if (categoria !== undefined) cambios.categoria = categoria;

  const producto = await Producto.findById(id);
  if (!producto) {
    logger.warn('Actualización rechazada: producto no encontrado', { id });
    return res.status(404).json({ error: `Producto con id ${id} no encontrado` });
  }

  producto.set(cambios);
  try {
    await producto.validate();
  } catch (err) {
    logger.warn('Actualización rechazada: datos inválidos', { id, error: mensajeDeValidacion(err) });
    return res.status(400).json({ error: mensajeDeValidacion(err) });
  }

  if (cambios.nombre !== undefined && (await Producto.exists({ nombre: producto.nombre, _id: { $ne: id } }))) {
    logger.warn('Actualización rechazada: nombre duplicado', { id, nombre: producto.nombre });
    return res.status(409).json({ error: `Ya existe un producto con el nombre "${producto.nombre}"` });
  }

  // Se replican los valores ya normalizados por Mongoose (ej. nombre con trim).
  const cambiosNormalizados = Object.fromEntries(Object.keys(cambios).map((k) => [k, producto[k]]));

  const comando = {
    tipo: TIPOS.ACTUALIZAR_PRODUCTO,
    id,
    cambios: cambiosNormalizados,
    timestamp: new Date().toISOString(),
  };

  logger.info('Propongo actualización de producto a Raft', { id, cambios: cambiosNormalizados });
  return ejecutarComando(res, comando);
}

async function eliminarProducto(req, res) {
  const { id } = req.params;

  if (!esIdValido(id)) {
    logger.warn('Eliminación rechazada: id con formato inválido', { id });
    return res.status(400).json({ error: 'El id debe ser un ObjectId de MongoDB válido' });
  }

  if (!(await Producto.exists({ _id: id }))) {
    logger.warn('Eliminación rechazada: producto no encontrado', { id });
    return res.status(404).json({ error: `Producto con id ${id} no encontrado` });
  }

  logger.info('Propongo eliminación de producto a Raft', { id });
  return ejecutarComando(res, { tipo: TIPOS.ELIMINAR_PRODUCTO, id, timestamp: new Date().toISOString() });
}

// Integración TP2 + Raft (sección 6.1):
//   Redis/Memurai decide QUIÉN entra a la sección crítica (leer stock -> validar ->
//   proponer). Raft decide cómo se ORDENA, REPLICA y CONFIRMA la modificación aceptada.
//   El lock se libera recién cuando la entrada quedó committed y aplicada, así la
//   próxima compra lee un stock que ya incluye esta.
async function comprarProducto(req, res) {
  const { id } = req.params;

  if (!esIdValido(id)) {
    logger.warn('Compra rechazada: id con formato inválido', { id });
    return res.status(400).json({ error: 'El id debe ser un ObjectId de MongoDB válido' });
  }

  const { cantidad } = req.body || {};

  if (!esCantidadValida(cantidad)) {
    logger.warn('Compra rechazada: cantidad inválida', { id, cantidad });
    return res.status(400).json({ error: 'La "cantidad" debe ser un número entero mayor a 0' });
  }

  if (!(await Producto.exists({ _id: id }))) {
    logger.warn('Compra rechazada: producto no encontrado', { id });
    return res.status(404).json({ error: `Producto con id ${id} no encontrado` });
  }

  const recurso = `producto:${id}`;
  const ownerId = crypto.randomUUID();
  const ttlMs = Number(process.env.LOCK_TTL_MS) || 10000;

  await conectar();
  const obtuvoLock = await acquireLock(recurso, ownerId, ttlMs);

  if (!obtuvoLock) {
    logger.warn('Compra rechazada: recurso bloqueado por otra operación (lock Redis ocupado)', { id });
    return res.status(409).json({
      error: `El producto ${id} está siendo modificado por otra operación, reintentá en unos instantes`,
    });
  }

  logger.info('Lock adquirido (Redis/Memurai)', { recurso, ownerId, ttlMs });

  try {
    // Sección crítica: leer -> (delay artificial) -> proponer a Raft -> esperar commit.
    const producto = await Producto.findById(id);
    const stockLeido = producto.stock;

    if (stockLeido < cantidad) {
      logger.warn('Compra rechazada: stock insuficiente', { id, stockLeido, cantidad });
      return res.status(409).json({
        error: `Stock insuficiente para "${producto.nombre}" (disponible: ${stockLeido})`,
      });
    }

    const delayMs = Number(process.env.COMPRA_DELAY_MS) || 0;
    if (delayMs > 0) {
      await delay(delayMs);
    }

    const comando = {
      tipo: TIPOS.COMPRAR_PRODUCTO,
      id,
      cantidad,
      stockLeido,
      stockNuevo: stockLeido - cantidad,
      timestamp: new Date().toISOString(),
    };

    logger.info('Propongo compra a Raft (dentro de la sección crítica)', { id, cantidad, stockLeido, stockNuevo: comando.stockNuevo });
    return await ejecutarComando(res, comando);
  } finally {
    await releaseLock(recurso, ownerId);
    logger.info('Lock liberado (Redis/Memurai)', { recurso, ownerId });
  }
}

module.exports = {
  listarProductos,
  obtenerProductoPorId,
  crearProducto,
  actualizarProducto,
  eliminarProducto,
  comprarProducto,
};
