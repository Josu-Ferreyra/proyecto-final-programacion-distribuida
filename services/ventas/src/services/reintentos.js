const config = require('../config/env');
const logger = require('../config/logger');
const inventario = require('../clients/inventarioClient');
const { estaConectada } = require('../config/db');
const { Compra, ESTADOS } = require('../models/compra.model');
const { RespuestaRemota } = require('../errors');

// Proceso de reintentos de los reintegros pendientes (TP5 §6.3, C3, y decisión D7).
// Cada REINTENTO_REINTEGRO_MS (30 s por defecto) vuelve a pedir C3 para:
//   - las compras en CANCELACION_PENDIENTE -> pasan a CANCELADA;
//   - las compras FALLIDA con reintegroPendiente -> reintegroPendiente = false.
//
// Es seguro reintentar porque el reintegro es idempotente por referencia: 204 si
// reintegra (o ya estaba reintegrado) y 404 si no había descuento. Mientras tanto las
// unidades siguen descontadas, que es el error menos grave: no permite vender de más.

let corriendo = false;
let timer = null;

async function reintegrar(compra) {
  try {
    await inventario.reintegrar(compra.id);
  } catch (err) {
    if (!(err instanceof RespuestaRemota && err.status === 404)) throw err;
  }
}

async function reintentarPendientes() {
  if (corriendo || !estaConectada()) return; // no superponer ejecuciones
  corriendo = true;
  try {
    const pendientes = await Compra.find({
      $or: [{ estado: ESTADOS.CANCELACION_PENDIENTE }, { reintegroPendiente: true }],
    });
    if (pendientes.length > 0) {
      logger.info('Reintentando reintegros pendientes', { operacion: 'reintentos', pendientes: pendientes.length });
    }

    for (const compra of pendientes) {
      try {
        await reintegrar(compra);
        if (compra.estado === ESTADOS.CANCELACION_PENDIENTE) compra.estado = ESTADOS.CANCELADA;
        compra.reintegroPendiente = false;
        await compra.save();
        logger.info('Reintegro completado', { operacion: 'reintentos', compraId: compra.id, estado: compra.estado });
      } catch (err) {
        logger.warn('El reintegro sigue pendiente', { operacion: 'reintentos', compraId: compra.id, error: err.message });
      }
    }
  } catch (err) {
    logger.error('No se pudieron leer los reintegros pendientes', { operacion: 'reintentos', error: err.message });
  } finally {
    corriendo = false;
  }
}

function iniciarReintentos() {
  timer = setInterval(reintentarPendientes, config.reintentoReintegroMs);
  logger.info('Proceso de reintentos iniciado', { operacion: 'reintentos', cadaMs: config.reintentoReintegroMs });
}

function detenerReintentos() {
  clearInterval(timer);
}

module.exports = { iniciarReintentos, detenerReintentos, reintentarPendientes };
