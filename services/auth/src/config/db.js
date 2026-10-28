const mongoose = require('mongoose');
const config = require('./env');
const logger = require('./logger');

// Sin buffer: si la base no está conectada, una consulta falla enseguida (y se
// responde 503) en lugar de quedar esperando a que vuelva la conexión. Por eso los
// índices no se crean al definir el modelo (todavía no hay conexión) sino en
// server.js, después de conectar.
mongoose.set('bufferCommands', false);
mongoose.set('autoCreate', false);
mongoose.set('autoIndex', false);

mongoose.connection.on('disconnected', () => {
  logger.warn('Conexión a MongoDB perdida', { operacion: 'db.connection' });
});
mongoose.connection.on('reconnected', () => {
  logger.info('Conexión a MongoDB recuperada', { operacion: 'db.connection' });
});

// Al arrancar, la base puede no estar lista todavía (por ejemplo, el contenedor de
// Mongo sigue iniciando). Se reintenta en lugar de terminar el proceso al primer fallo.
async function conectarConReintentos(uri, { intentos = config.mongodbIntentos, esperaMs = config.mongodbEsperaMs } = {}) {
  for (let i = 1; i <= intentos; i++) {
    try {
      await mongoose.connect(uri, { serverSelectionTimeoutMS: 3000 });
      logger.info('MongoDB conectado', { operacion: 'db.connect', db: mongoose.connection.name });
      return;
    } catch (err) {
      logger.warn(`MongoDB no disponible (intento ${i}/${intentos})`, { operacion: 'db.connect', error: err.message });
      if (i < intentos) await new Promise((r) => setTimeout(r, esperaMs));
    }
  }
  throw new Error(`No se pudo conectar a MongoDB después de ${intentos} intentos`);
}

// Middleware: si la base se cae después del arranque, 503 en lugar de colgar.
// /health no pasa por acá: indica que el proceso está vivo.
function requiereDb(req, res, next) {
  if (mongoose.connection.readyState === 1) return next();
  const error = 'Base de datos no disponible';
  logger.warn('Request rechazada', { operacion: `${req.method} ${req.originalUrl.split('?')[0]}`, status: 503, error });
  res.status(503).json({ error, servicio: config.serviceName });
}

// Errores del driver que indican que la base no responde (y no un error del pedido).
const ERRORES_DE_CONEXION = new Set([
  'MongoNetworkError',
  'MongoNetworkTimeoutError',
  'MongoServerSelectionError',
  'MongooseServerSelectionError',
  'MongoNotConnectedError',
  'MongoTopologyClosedError',
]);

function esErrorDeConexion(err) {
  return ERRORES_DE_CONEXION.has(err.name) || ERRORES_DE_CONEXION.has(err.cause?.name);
}

module.exports = { conectarConReintentos, requiereDb, esErrorDeConexion };
