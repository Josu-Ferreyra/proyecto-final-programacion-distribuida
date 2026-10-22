// Cliente HTTP de Catálogo: contrato C4 (docs/06-comunicaciones.md §6.2).
//
// Encapsula la URL (CATALOGO_SERVICE_URL), el timeout (HTTP_TIMEOUT_MS) y la
// interpretación de las respuestas, para que la capa de negocio reciba un resultado
// tipado y no detalles de fetch. Distingue errores funcionales de indisponibilidad
// (sección 15.2 del TP6):
//   200            -> { existe: true, activo }
//   404            -> { existe: false }
//   400            -> { existe: false } (Catálogo no reconoce el formato del id)
//   timeout / DNS / conexión rechazada / 5xx -> lanza ErrorInventario 503

const { noDisponible } = require('../stock/errores');

function crearCatalogoClient({ baseUrl, timeoutMs, logger }) {
  async function obtenerProducto(productoId) {
    const url = `${baseUrl}/productos/${encodeURIComponent(productoId)}`;
    let res;
    try {
      res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
    } catch (err) {
      const causa = err.name === 'TimeoutError' ? `sin respuesta en ${timeoutMs} ms` : err.cause?.code || err.message;
      logger.warn('Catálogo no disponible', { operacion: 'C4 GET /productos/:id', dependencia: 'catalogo-service', productoId, error: causa });
      throw noDisponible('Catálogo no disponible: no se pudo verificar el producto', { dependencia: 'catalogo-service' });
    }

    if (res.status === 200) {
      const producto = await res.json();
      return { existe: true, activo: producto.activo !== false };
    }
    if (res.status === 404 || res.status === 400) {
      return { existe: false };
    }

    logger.error('Catálogo respondió un error inesperado', {
      operacion: 'C4 GET /productos/:id',
      dependencia: 'catalogo-service',
      productoId,
      status: res.status,
    });
    throw noDisponible('Catálogo no disponible: respondió un error inesperado', { dependencia: 'catalogo-service' });
  }

  return { obtenerProducto };
}

module.exports = { crearCatalogoClient };
