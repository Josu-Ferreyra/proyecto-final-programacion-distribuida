const config = require('../config/env');
const logger = require('../config/logger');
const { crearCliente } = require('./httpClient');
const { DependenciaNoDisponible, RespuestaRemota } = require('../errors');

// Token de la cuenta técnica de Ventas (rol SERVICIO, decisión D13 de docs/14-modelo-seguridad.md).
//
// Ventas no le pasa a Inventario el token del cliente: se autentica con su propia cuenta en
// auth-service (POST /auth/login) y usa ese token en C2 y C3. Así un cliente no puede mover stock
// llamando directo a Inventario, y el reintento de compensación de 30 s (D7) tiene identidad
// aunque no haya ningún cliente conectado.
//
// El token se cachea en memoria y se renueva 60 s antes de su exp: no se hace un login por
// compra. Ventas no verifica la firma de su propio token (eso lo hace Inventario): solo lee exp.
// Si auth-service no responde, se lanza DependenciaNoDisponible('auth-service') (D15).

const MARGEN_RENOVACION_S = 60;
const http = crearCliente({ nombre: 'auth-service', baseUrl: config.authServiceUrl, timeoutMs: config.httpTimeoutMs });

let cache = null; // { token, exp }

function vencimiento(token) {
  try {
    return JSON.parse(Buffer.from(token.split('.')[1], 'base64url')).exp;
  } catch {
    return 0;
  }
}

async function tokenDeServicio() {
  const ahora = Math.floor(Date.now() / 1000);
  if (cache && cache.exp - MARGEN_RENOVACION_S > ahora) return cache.token;

  let respuesta;
  try {
    respuesta = await http.post('/auth/login', { email: config.ventasServiceEmail, password: config.ventasServicePassword });
  } catch (err) {
    if (err instanceof RespuestaRemota) {
      // auth-service respondió, pero rechazó la cuenta técnica (credenciales mal configuradas o
      // cuenta deshabilitada). Para quien compra es lo mismo: Ventas no puede autenticarse.
      logger.error('auth-service rechazó el login de la cuenta de servicio', { operacion: 'authClient.login', dependencia: 'auth-service', status: err.status });
      throw new DependenciaNoDisponible('auth-service', `login de servicio rechazado (${err.status})`, 'POST /auth/login');
    }
    throw err;
  }

  const token = respuesta.datos?.accessToken;
  const exp = token ? vencimiento(token) : 0;
  if (!token || !exp) {
    logger.error('auth-service respondió el login sin un token válido', { operacion: 'authClient.login', dependencia: 'auth-service' });
    throw new DependenciaNoDisponible('auth-service', 'respuesta de login inválida', 'POST /auth/login');
  }
  cache = { token, exp };
  logger.info('Token de servicio obtenido', { operacion: 'authClient.login', venceEn: exp - ahora });
  return token;
}

// Lo usa inventarioClient cuando Inventario responde 401: el token pudo haber vencido en el medio.
function invalidar() {
  cache = null;
}

module.exports = { tokenDeServicio, invalidar };
