// Reglas de negocio de Inventario y coordinación de cada caso de uso.
//
// Las escrituras llegan acá solo en el Leader (las reenvía reenviarAlLeader). Este
// módulo valida, consulta a Catálogo cuando corresponde (C4, solo en el alta) y
// propone el comando a Raft. NO escribe en la base: eso lo hace la State Machine al
// aplicar, sobre el valor vigente.
//
// Los chequeos previos (referencia ya procesada, stock insuficiente) evitan proponer al
// log comandos que se sabe que van a ser rechazados. La State Machine vuelve a decidir
// al aplicar, así que la corrección no depende de ellos.

const { Stock } = require('../models/stock.model');
const { Descuento } = require('../models/descuento.model');
const { Movimiento } = require('../models/movimiento.model');
const { TIPOS } = require('../stateMachine');
const { solicitudInvalida, noEncontrado, conflicto, noDisponible } = require('../errores');

const ID_VALIDO = /^[A-Za-z0-9_-]{1,64}$/;
const MAX_ITEMS = 50;

function validarProductoId(productoId) {
  if (typeof productoId !== 'string' || !ID_VALIDO.test(productoId)) {
    throw solicitudInvalida('El productoId debe ser un identificador de hasta 64 caracteres (letras, números, "-" o "_")');
  }
}

function validarReferencia(referencia) {
  if (typeof referencia !== 'string' || !ID_VALIDO.test(referencia)) {
    throw solicitudInvalida('La referencia debe ser un identificador de hasta 64 caracteres (letras, números, "-" o "_")');
  }
}

function validarItems(items) {
  if (!Array.isArray(items) || items.length === 0 || items.length > MAX_ITEMS) {
    throw solicitudInvalida(`"items" debe ser una lista de 1 a ${MAX_ITEMS} elementos { productoId, cantidad }`);
  }
  const vistos = new Set();
  return items.map((item) => {
    const { productoId, cantidad } = item || {};
    validarProductoId(productoId);
    if (!Number.isInteger(cantidad) || cantidad <= 0) {
      throw solicitudInvalida(`La cantidad de ${productoId} debe ser un entero mayor a 0`);
    }
    if (vistos.has(productoId)) {
      throw solicitudInvalida(`El producto ${productoId} aparece más de una vez en "items"`);
    }
    vistos.add(productoId);
    return { productoId, cantidad };
  });
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function crearStockService({ raft, catalogo, config, logger }) {
  // Propone y espera commit + aplicación. Los errores del protocolo se traducen a 503:
  // para quien llama es "Inventario no pudo confirmar la operación", sin detalles de Raft.
  async function proponer(comando) {
    try {
      const { resultado } = await raft.proponer(comando);
      return resultado;
    } catch (err) {
      if (!err.codigo) throw err;
      logger.warn('Escritura no confirmada por el cluster', { operacion: comando.tipo, motivo: err.codigo, error: err.message });
      const mensajes = {
        NO_SOY_LEADER: 'El nodo dejó de ser Leader: reintentá en unos segundos',
        SIN_QUORUM: 'Inventario no alcanzó mayoría para confirmar la operación: no se aplicó',
        LIDERAZGO_PERDIDO: 'Inventario cambió de Leader durante la operación: reintentá en unos segundos',
      };
      throw noDisponible(mensajes[err.codigo] || 'Inventario no disponible');
    }
  }

  async function consultar(productoIds) {
    if (productoIds === undefined) {
      const todos = await Stock.find().sort({ productoId: 1 }).lean();
      return todos.map((s) => ({ productoId: s.productoId, stock: s.cantidad }));
    }
    productoIds.forEach(validarProductoId);
    const encontrados = new Map(
      (await Stock.find({ productoId: { $in: productoIds } }).lean()).map((s) => [s.productoId, s.cantidad])
    );
    // Un producto sin stock registrado tiene 0 unidades disponibles.
    return productoIds.map((id) => ({ productoId: id, stock: encontrados.get(id) ?? 0 }));
  }

  async function movimientos(productoId) {
    const filtro = {};
    if (productoId !== undefined) {
      validarProductoId(productoId);
      filtro.productoId = productoId;
    }
    const lista = await Movimiento.find(filtro).sort({ indiceRaft: 1 }).limit(500).lean();
    return lista.map(({ _id, ...m }) => m);
  }

  // PUT /stock/:productoId -> alta (con C4) o ajuste.
  async function fijar(productoId, cantidad) {
    validarProductoId(productoId);
    if (!Number.isInteger(cantidad) || cantidad < 0) {
      throw solicitudInvalida('La "cantidad" debe ser un entero mayor o igual a 0');
    }

    const existe = await Stock.exists({ productoId });
    if (!existe) {
      // C4: solo en el alta, y ANTES de proponer (la State Machine no hace HTTP).
      const producto = await catalogo.obtenerProducto(productoId);
      if (!producto.existe) throw noEncontrado(`El producto ${productoId} no existe en Catálogo`);
      if (!producto.activo) throw conflicto(`El producto ${productoId} está dado de baja en Catálogo`);
    }

    const comando = {
      tipo: existe ? TIPOS.AJUSTAR_STOCK : TIPOS.ALTA_STOCK,
      productoId,
      cantidad,
      fecha: new Date().toISOString(), // la fija el Leader: igual en todas las réplicas
    };
    logger.info(existe ? 'Propongo ajuste de stock' : 'Propongo alta de stock', { operacion: comando.tipo, productoId, cantidad });
    const resultado = await proponer(comando);
    return { productoId: resultado.productoId, stock: resultado.stock };
  }

  // POST /descuentos (C2): todo o nada, idempotente por referencia.
  async function descontar(referencia, itemsCrudos) {
    validarReferencia(referencia);
    const items = validarItems(itemsCrudos);

    const previo = await Descuento.findOne({ referencia }).lean();
    if (previo) return { creado: false, referencia, items: previo.items };

    const actuales = new Map(
      (await Stock.find({ productoId: { $in: items.map((i) => i.productoId) } }).lean()).map((s) => [s.productoId, s.cantidad])
    );
    const faltantes = items
      .map((i) => ({ productoId: i.productoId, solicitado: i.cantidad, disponible: actuales.get(i.productoId) ?? 0 }))
      .filter((f) => f.disponible < f.solicitado);
    if (faltantes.length > 0) {
      logger.warn('Descuento rechazado: stock insuficiente', { operacion: 'DESCONTAR', referencia, faltantes });
      throw conflicto('Stock insuficiente', { faltantes });
    }

    if (config.descuentoDelayMs > 0) await delay(config.descuentoDelayMs);

    logger.info('Propongo descuento de stock', { operacion: TIPOS.DESCONTAR, referencia, items });
    const resultado = await proponer({ tipo: TIPOS.DESCONTAR, referencia, items, fecha: new Date().toISOString() });

    if (resultado.estado === 'RECHAZADO') {
      throw conflicto('Stock insuficiente', { faltantes: resultado.faltantes });
    }
    return { creado: resultado.estado === 'APLICADO', referencia, items: resultado.items };
  }

  // DELETE /descuentos/:referencia (C3): reintegra exactamente lo descontado.
  async function reintegrar(referencia) {
    validarReferencia(referencia);

    const descuento = await Descuento.findOne({ referencia }).lean();
    if (!descuento) throw noEncontrado(`No hay un descuento con la referencia ${referencia}`);
    if (descuento.estado === 'REINTEGRADO') return; // idempotente: 204

    logger.info('Propongo reintegro de stock', { operacion: TIPOS.REINTEGRAR, referencia });
    const resultado = await proponer({ tipo: TIPOS.REINTEGRAR, referencia, fecha: new Date().toISOString() });
    if (resultado.estado === 'NO_EXISTE') throw noEncontrado(`No hay un descuento con la referencia ${referencia}`);
  }

  return { consultar, movimientos, fijar, descontar, reintegrar };
}

module.exports = { crearStockService };
