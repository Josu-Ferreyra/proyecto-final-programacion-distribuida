// Toda la configuración sale de variables de entorno: el mismo código corre con
// `npm start` (valores del .env) y en Docker Compose (valores de compose.yml).
// No hay URLs ni hosts escritos en el código.

function entero(nombre, porDefecto) {
  const valor = process.env[nombre];
  if (valor === undefined || valor === '') return porDefecto;
  const numero = Number(valor);
  if (!Number.isInteger(numero) || numero <= 0) {
    throw new Error(`La variable ${nombre} debe ser un entero positivo (valor actual: "${valor}")`);
  }
  return numero;
}

function obligatoria(nombre) {
  const valor = process.env[nombre];
  if (!valor) throw new Error(`Falta la variable de entorno ${nombre} (ver .env.example)`);
  return valor;
}

// HS256 necesita una clave larga: con menos de 32 caracteres se puede adivinar por fuerza bruta.
function secretoJwt() {
  const valor = obligatoria('JWT_SECRET');
  if (valor.length < 32) {
    throw new Error('JWT_SECRET tiene que tener al menos 32 caracteres (ver .env.example para generar uno)');
  }
  return valor;
}

const config = Object.freeze({
  serviceName: process.env.SERVICE_NAME || 'ventas-service',
  port: entero('PORT', 3300),
  mongodbUri: obligatoria('MONGODB_URI'),
  mongodbIntentos: entero('MONGODB_CONNECT_RETRIES', 10),
  mongodbEsperaMs: entero('MONGODB_RETRY_MS', 3000),
  logLevel: process.env.LOG_LEVEL || 'info',

  // Dependencias (C1 a Catálogo, C2 y C3 a Inventario). Local: localhost; Compose:
  // nombre DNS del servicio. Nunca escritas en el código (sección 6.3 del TP6).
  catalogoUrl: obligatoria('CATALOGO_SERVICE_URL'),
  inventarioUrl: obligatoria('INVENTARIO_SERVICE_URL'),
  httpTimeoutMs: entero('HTTP_TIMEOUT_MS', 3000), // TP5 §6: 3 s por llamada

  // Cada cuánto se reintentan los reintegros pendientes (TP5 §6.3 y D7).
  reintentoReintegroMs: entero('REINTENTO_REINTEGRO_MS', 30000),

  // JWT (TP7, D9 y D16): mismo secreto y emisor que auth-service y los demás servicios.
  jwtSecret: secretoJwt(),
  jwtIssuer: process.env.JWT_ISSUER || 'auth-service',
});

module.exports = config;
