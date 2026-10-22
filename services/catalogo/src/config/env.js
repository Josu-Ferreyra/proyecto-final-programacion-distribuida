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

const config = Object.freeze({
  serviceName: process.env.SERVICE_NAME || 'catalogo-service',
  port: entero('PORT', 3100),
  mongodbUri: obligatoria('MONGODB_URI'),
  mongodbIntentos: entero('MONGODB_CONNECT_RETRIES', 10),
  mongodbEsperaMs: entero('MONGODB_RETRY_MS', 3000),
  logLevel: process.env.LOG_LEVEL || 'info',
});

module.exports = config;
