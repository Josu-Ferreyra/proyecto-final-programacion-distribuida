const crypto = require('node:crypto');
const { conflicto, noDisponible } = require('../stock/errores');

// Lock distribuido por producto (regla R8), heredado del TP2/TP4: SET NX PX para tomarlo
// y un script Lua para liberarlo solo si sigue siendo nuestro. Es un detalle interno de
// Inventario: ningún otro servicio sabe que existe.
//
// Cambios respecto del TP4:
//   - varios productos por operación: los locks se toman ORDENADOS por productoId, así
//     dos descuentos con los mismos productos no se bloquean mutuamente;
//   - si el lock está ocupado se reintenta hasta LOCK_WAIT_MS antes de responder 409;
//   - si Redis no responde, 503 (no 500 ni un pedido colgado).

const UNLOCK_SCRIPT = `
if redis.call("GET", KEYS[1]) == ARGV[1] then
  return redis.call("DEL", KEYS[1])
else
  return 0
end
`;

const REINTENTO_MS = 50;

function clave(productoId) {
  return `lock:inventario:producto:${productoId}`;
}

function crearLock({ client, ttlMs, esperaMs, logger }) {
  async function redis(operacion) {
    if (!client.isReady) throw noDisponible('Redis no disponible: no se puede tomar el lock del producto');
    try {
      return await operacion();
    } catch (err) {
      logger.warn('Fallo al usar Redis', { operacion: 'lock', error: err.message });
      throw noDisponible('Redis no disponible: no se puede tomar el lock del producto');
    }
  }

  async function tomarUno(productoId, owner) {
    const limite = Date.now() + esperaMs;
    for (;;) {
      const ok = await redis(() => client.set(clave(productoId), owner, { NX: true, PX: ttlMs }));
      if (ok === 'OK') return true;
      if (Date.now() >= limite) return false;
      await new Promise((r) => setTimeout(r, REINTENTO_MS));
    }
  }

  async function liberar(productoIds, owner) {
    for (const id of productoIds) {
      try {
        await client.eval(UNLOCK_SCRIPT, { keys: [clave(id)], arguments: [owner] });
      } catch (err) {
        // Si no se pudo liberar, el TTL lo libera solo.
        logger.warn('No se pudo liberar el lock; vence por TTL', { operacion: 'lock', productoId: id, error: err.message });
      }
    }
  }

  // Ejecuta fn con el lock de todos los productos tomados.
  async function conLock(productoIds, fn) {
    const ordenados = [...new Set(productoIds)].sort();
    const owner = crypto.randomUUID();
    const tomados = [];
    try {
      for (const id of ordenados) {
        if (!(await tomarUno(id, owner))) {
          logger.warn('Lock ocupado: se rechaza la operación', { operacion: 'lock', productoId: id, esperaMs });
          throw conflicto(`El producto ${id} está siendo modificado por otra operación, reintentá en unos instantes`);
        }
        tomados.push(id);
      }
      logger.debug('Locks tomados', { operacion: 'lock', productos: ordenados });
      return await fn();
    } finally {
      await liberar(tomados, owner);
    }
  }

  return { conLock };
}

module.exports = { crearLock };
