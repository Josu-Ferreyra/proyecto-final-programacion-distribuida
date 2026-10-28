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
  serviceName: process.env.SERVICE_NAME || 'catalogo-service',
  port: entero('PORT', 3100),
  mongodbUri: obligatoria('MONGODB_URI'),
  mongodbIntentos: entero('MONGODB_CONNECT_RETRIES', 10),
  mongodbEsperaMs: entero('MONGODB_RETRY_MS', 3000),
  logLevel: process.env.LOG_LEVEL || 'info',

  // JWT (D9, D16): el secreto llega por entorno y el servicio no arranca sin uno robusto.
  jwtSecret: secretoJwt(),
  jwtIssuer: process.env.JWT_ISSUER || 'auth-service',
});

module.exports = config;
