const mongoose = require('mongoose');
const logger = require('../config/logger');
const catalogo = require('../clients/catalogoClient');
const inventario = require('../clients/inventarioClient');
const { Compra, ESTADOS } = require('../models/compra.model');
const { ErrorNegocio, DependenciaNoDisponible, RespuestaRemota } = require('../errors');

// Reglas de negocio de Ventas (ficha de Ventas, TP5 §4.2) y coordinación de sus casos
// de uso (TP5 §6.5.1 y §6.5.2). Ventas no conoce el stock, ni Raft, ni el lock de Redis:
// Catálogo informa, Inventario decide sobre el stock y Ventas registra la compra.

const ID_VALIDO = /^[A-Za-z0-9_-]{1,64}$/;
const MAX_ITEMS = 50;

const redondear = (valor) => Math.round(valor * 100) / 100;

function validarCompraId(id) {
  if (!mongoose.Types.ObjectId.isValid(id)) {
    throw new ErrorNegocio(400, 'El id de la compra debe ser un ObjectId de MongoDB válido');
  }
}

// Formato del pedido (R6 y productoId sin repetir). Es validación de entrada de SU
// contrato: Ventas no valida nada del producto ni del stock.
function validarFormato(body) {
  const items = body?.items;
  if (!Array.isArray(items) || items.length === 0 || items.length > MAX_ITEMS) {
    throw new ErrorNegocio(400, `"items" debe ser una lista de 1 a ${MAX_ITEMS} elementos { productoId, cantidad }`);
  }
  const vistos = new Set();
  return items.map((item, i) => {
    const { productoId, cantidad } = item || {};
    if (typeof productoId !== 'string' || !ID_VALIDO.test(productoId)) {
      throw new ErrorNegocio(400, `items[${i}].productoId debe ser un identificador de producto válido`);
    }
    if (!Number.isInteger(cantidad) || cantidad <= 0) {
      throw new ErrorNegocio(400, `items[${i}].cantidad debe ser un entero mayor a 0`);
    }
    if (vistos.has(productoId)) {
      throw new ErrorNegocio(400, `El producto ${productoId} aparece más de una vez en "items"`);
    }
    vistos.add(productoId);
    return { productoId, cantidad };
  });
}

// ---------------------------------------------------------------- C1 · Catálogo

// Catálogo informa; Ventas decide. Un id ausente o un producto inactivo son errores
// funcionales (400 / 409), no una caída. Sin respuesta, o un 503 de Catálogo (su base
// caída), es "no disponible": 503. Cualquier otra respuesta inesperada: 502.
async function consultarCatalogo(ids) {
  let productos;
  try {
    productos = await catalogo.obtenerProductos(ids);
  } catch (err) {
    if (err instanceof DependenciaNoDisponible || (err instanceof RespuestaRemota && err.status === 503)) {
      throw new ErrorNegocio(503, 'Catálogo no disponible: no se pudo registrar la compra', { dependencia: err.dependencia });
    }
    if (err instanceof RespuestaRemota) {
      throw new ErrorNegocio(502, 'Catálogo respondió un error inesperado', { dependencia: err.dependencia, statusRemoto: err.status });
    }
    throw err;
  }

  const formatoValido =
    Array.isArray(productos) &&
    productos.every((p) => typeof p?.id === 'string' && typeof p.nombre === 'string' && typeof p.precio === 'number');
  if (!formatoValido) {
    logger.error('Catálogo respondió en un formato inesperado', { operacion: 'C1 GET /productos', dependencia: 'catalogo-service' });
    throw new ErrorNegocio(502, 'Catálogo respondió en un formato inesperado', { dependencia: 'catalogo-service' });
  }
  return new Map(productos.map((p) => [p.id, p]));
}

// ---------------------------------------------------------------- compensación (C3)

// ¿Pudo haberse aplicado el descuento aunque Ventas no recibió la confirmación?
//   timeout                     -> sí: Inventario pudo procesarlo después de que Ventas cortó
//   5xx / 421 de Inventario     -> sí: con Raft, un 503 puede ser "no logró mayoría a tiempo"
//                                  y esa entrada todavía puede confirmarse más tarde
//   conexión rechazada / DNS    -> no: el pedido nunca llegó
function descuentoIncierto(err) {
  if (err instanceof DependenciaNoDisponible) return err.causa === 'timeout';
  if (err instanceof RespuestaRemota) return err.status >= 500 || err.status === 421;
  return false;
}

// Deja el stock como estaba después de un descuento posiblemente aplicado. Devuelve
// cómo quedó: 'reintegrado' o 'pendiente' (compra FALLIDA con reintegro pendiente, D7).
//
// Un 404 de C3 solo es concluyente si el descuento ya terminó. Después de un timeout el
// descuento puede seguir en camino (esperando el lock o el commit de Raft) y aplicarse
// DESPUÉS del 404. Por eso, ante un 404 también se registra el reintegro como pendiente:
// el reintento de los 30 s lo vuelve a pedir cuando ese descuento atrasado ya terminó
// (docs/12-comunicacion-y-fallos.md §12.3).
async function compensar({ compraId, detalle, total, motivo }) {
  let resultado;
  try {
    await inventario.reintegrar(compraId);
    logger.info('Compensación aplicada: stock reintegrado', { operacion: 'compensacion', compraId, motivo });
    return 'reintegrado';
  } catch (err) {
    if (err instanceof RespuestaRemota && err.status === 404) {
      resultado = 'el descuento todavía no figura en Inventario: se vuelve a verificar en el próximo reintento';
    } else if (err instanceof DependenciaNoDisponible || err instanceof RespuestaRemota) {
      resultado = `el reintegro no se pudo confirmar (${err.message})`;
    } else {
      throw err;
    }
  }

  logger.warn('Compensación pendiente', { operacion: 'compensacion', compraId, motivo, detalle: resultado });
  try {
    await Compra.create({
      _id: compraId,
      estado: ESTADOS.FALLIDA,
      reintegroPendiente: true,
      items: detalle,
      total,
      motivoFallo: `${motivo}; ${resultado}`,
    });
  } catch (err) {
    // Ni Inventario ni la base de Ventas respondieron: solo queda el log con el compraId,
    // que es la referencia del descuento en Inventario (ver análisis de fallo parcial).
    logger.error('No se pudo registrar la compra fallida: el reintegro queda solo en este log', {
      operacion: 'compensacion',
      compraId,
      motivo,
      error: err.message,
    });
  }
  return 'pendiente';
}

// ---------------------------------------------------------------- casos de uso

// POST /compras (TP5 §6.5.1). Reemplaza a comprarProducto del TP4.
async function registrarCompra(body) {
  const items = validarFormato(body);
  const compraId = new mongoose.Types.ObjectId().toString(); // referencia del descuento

  // C1 · Catálogo informa: ¿existen?, ¿están activos?, nombre y precio vigente.
  const productos = await consultarCatalogo(items.map((i) => i.productoId));
  const productosInexistentes = items.filter((i) => !productos.has(i.productoId)).map((i) => i.productoId);
  if (productosInexistentes.length > 0) {
    throw new ErrorNegocio(400, 'Hay productos que no existen en Catálogo', { productosInexistentes });
  }
  const productosInactivos = items.filter((i) => productos.get(i.productoId).activo === false).map((i) => i.productoId);
  if (productosInactivos.length > 0) {
    throw new ErrorNegocio(409, 'Hay productos dados de baja en Catálogo', { productosInactivos });
  }

  // Precio y nombre quedan congelados en la compra; el total se calcula una sola vez.
  const detalle = items.map((i) => ({
    productoId: i.productoId,
    nombreProducto: productos.get(i.productoId).nombre,
    precioUnitario: productos.get(i.productoId).precio,
    cantidad: i.cantidad,
  }));
  const total = redondear(detalle.reduce((suma, i) => suma + i.precioUnitario * i.cantidad, 0));

  // C2 · Inventario decide sobre el stock. Ventas nunca consulta el stock antes: pide el
  // descuento e interpreta la respuesta (TP5 §6.1).
  try {
    await inventario.descontar(compraId, items);
  } catch (err) {
    if (err instanceof RespuestaRemota && err.status === 409) {
      if (Array.isArray(err.cuerpo?.faltantes)) {
        throw new ErrorNegocio(409, 'Stock insuficiente', { faltantes: err.cuerpo.faltantes });
      }
      // Otro conflicto de Inventario (por ejemplo, el producto lo está modificando otra
      // operación): no se descontó nada y se informa tal cual.
      throw new ErrorNegocio(409, err.cuerpo?.error || 'Inventario rechazó el descuento', { dependencia: err.dependencia });
    }
    if (err instanceof RespuestaRemota && err.status < 500 && err.status !== 421) {
      // 400 u otro 4xx: Inventario rechazó el pedido sin aplicarlo. Es un desacuerdo de
      // contrato, no una caída.
      throw new ErrorNegocio(502, 'Inventario rechazó el pedido de descuento', { dependencia: err.dependencia, statusRemoto: err.status });
    }
    if (!(err instanceof DependenciaNoDisponible || err instanceof RespuestaRemota)) throw err;

    const detalleError = { dependencia: err.dependencia };
    if (descuentoIncierto(err)) {
      detalleError.compraId = compraId;
      detalleError.compensacion = await compensar({ compraId, detalle, total, motivo: `descuento sin confirmar (${err.message})` });
    }
    throw new ErrorNegocio(503, 'Inventario no disponible: no se pudo registrar la compra', detalleError);
  }

  // Ventas modifica solo lo suyo. Si no puede guardar, deshace el descuento.
  try {
    const compra = await Compra.create({ _id: compraId, estado: ESTADOS.CONFIRMADA, items: detalle, total });
    logger.info('Compra confirmada', { operacion: 'compras.registrar', compraId, total, items: detalle.length });
    return compra;
  } catch (err) {
    logger.error('No se pudo guardar la compra después de descontar el stock', { operacion: 'compras.registrar', compraId, error: err.message });
    const compensacion = await compensar({ compraId, detalle, total, motivo: 'error al guardar la compra' });
    throw new ErrorNegocio(503, 'No se pudo registrar la compra: la base de Ventas no respondió', { compraId, compensacion });
  }
}

// GET /compras/:id: lee solo la base propia; no llama a nadie (TP5 §5.2).
async function obtenerCompra(id) {
  validarCompraId(id);
  const compra = await Compra.findById(id);
  if (!compra) throw new ErrorNegocio(404, `Compra con id ${id} no encontrada`);
  return compra;
}

// PATCH /compras/:id/cancelar (TP5 §6.5.2). La regla "solo se cancela una compra
// CONFIRMADA" es de Ventas; Inventario solo reintegra cuando se lo piden.
async function cancelarCompra(id) {
  validarCompraId(id);

  // Primero se marca la intención (CONFIRMADA -> CANCELACION_PENDIENTE) de forma atómica:
  // dos cancelaciones simultáneas no pueden pasar las dos, y si Ventas se cae después
  // del reintegro, el reintento de los 30 s termina de cerrarla.
  const compra = await Compra.findOneAndUpdate(
    { _id: id, estado: ESTADOS.CONFIRMADA },
    { estado: ESTADOS.CANCELACION_PENDIENTE },
    { new: true }
  );
  if (!compra) {
    const actual = await Compra.findById(id);
    if (!actual) throw new ErrorNegocio(404, `Compra con id ${id} no encontrada`);
    const motivos = {
      [ESTADOS.CANCELADA]: 'La compra ya está cancelada',
      [ESTADOS.CANCELACION_PENDIENTE]: 'La cancelación de esta compra ya está en curso',
      [ESTADOS.FALLIDA]: 'La compra no llegó a confirmarse: no hay nada que cancelar',
    };
    throw new ErrorNegocio(409, motivos[actual.estado] || 'La compra no se puede cancelar', { estado: actual.estado });
  }

  try {
    await inventario.reintegrar(id);
  } catch (err) {
    const reintegradoAntes = err instanceof RespuestaRemota && err.status === 404; // no había descuento
    if (!reintegradoAntes) {
      if (!(err instanceof DependenciaNoDisponible || err instanceof RespuestaRemota)) throw err;
      logger.warn('Cancelación pendiente: Inventario no confirmó el reintegro', { operacion: 'compras.cancelar', compraId: id, error: err.message });
      return {
        status: 202,
        cuerpo: {
          compraId: id,
          estado: ESTADOS.CANCELACION_PENDIENTE,
          mensaje: 'Inventario no está disponible: el reintegro del stock se reintenta automáticamente',
        },
      };
    }
  }

  compra.estado = ESTADOS.CANCELADA;
  await compra.save();
  logger.info('Compra cancelada', { operacion: 'compras.cancelar', compraId: id });
  return { status: 200, cuerpo: { compraId: id, estado: ESTADOS.CANCELADA } };
}

module.exports = { registrarCompra, obtenerCompra, cancelarCompra };
