const logger = require('../config/logger');
const { DependenciaNoDisponible, RespuestaRemota } = require('../errors');

// Cliente HTTP genérico para hablar con otro microservicio (sección 6.2 del TP6).
// Toda URL, timeout y tratamiento de respuesta queda acá: los controllers y servicios
// nunca llaman a fetch. No hay reintentos dentro del pedido del cliente (TP5 §6).
//
// Resultado:
//   2xx                          -> { status, datos }
//   respuesta no exitosa         -> lanza RespuestaRemota (con status y cuerpo)
//   sin respuesta válida         -> lanza DependenciaNoDisponible (con la causa)

// Códigos de error de Node/undici que indican que el nombre no resolvió. Pasa cuando el
// contenedor destino está detenido: su nombre desaparece del DNS de la red de Docker.
const CODIGOS_DNS = new Set(['ENOTFOUND', 'EAI_AGAIN']);

function clasificar(err) {
  if (err.name === 'TimeoutError' || err.name === 'AbortError') return 'timeout';
  if (CODIGOS_DNS.has(err.cause?.code)) return 'dns';
  return 'conexion';
}

function crearCliente({ nombre, baseUrl, timeoutMs }) {
  const base = baseUrl.replace(/\/+$/, '');

  // headersExtra: por ejemplo { Authorization: 'Bearer …' } (TP7). Nunca se loguean.
  async function pedir(metodo, ruta, cuerpo, headersExtra = {}) {
    const operacion = `${metodo} ${ruta.split('?')[0]}`;
    const inicio = Date.now();
    let res;
    try {
      res = await fetch(`${base}${ruta}`, {
        method: metodo,
        headers: { ...(cuerpo ? { 'Content-Type': 'application/json' } : {}), ...headersExtra },
        body: cuerpo ? JSON.stringify(cuerpo) : undefined,
        signal: AbortSignal.timeout(timeoutMs), // timeout explícito: nunca una espera indefinida
      });
    } catch (err) {
      const causa = clasificar(err);
      logger.error('Dependencia no disponible', {
        operacion,
        dependencia: nombre,
        causa,
        ms: Date.now() - inicio,
        error: err.cause?.code || err.message,
      });
      throw new DependenciaNoDisponible(nombre, causa, operacion);
    }

    // El cuerpo puede no ser JSON (por ejemplo, un proxy que responde HTML): no se rompe.
    const datos = res.status === 204 ? null : await res.json().catch(() => null);

    if (!res.ok) {
      const nivel = res.status >= 500 ? 'error' : 'warn';
      logger.log(nivel, 'Respuesta no exitosa de dependencia', {
        operacion,
        dependencia: nombre,
        status: res.status,
        ms: Date.now() - inicio,
        error: datos?.error,
      });
      throw new RespuestaRemota(nombre, res.status, datos, operacion);
    }

    logger.debug('Respuesta de dependencia', { operacion, dependencia: nombre, status: res.status, ms: Date.now() - inicio });
    return { status: res.status, datos };
  }

  return {
    get: (ruta, headers) => pedir('GET', ruta, undefined, headers),
    post: (ruta, cuerpo, headers) => pedir('POST', ruta, cuerpo, headers),
    delete: (ruta, headers) => pedir('DELETE', ruta, undefined, headers),
  };
}

module.exports = { crearCliente };
