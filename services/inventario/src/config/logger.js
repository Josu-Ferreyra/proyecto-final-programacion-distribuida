const winston = require('winston');
const config = require('./env');

// Logs solo por stdout: en Docker los recoge `docker compose logs`, así que el
// contenedor no escribe archivos. Cada línea lleva "servicio" y "nodo".
// En producción (la imagen Docker) salen en JSON; en local, en una línea legible.
const formatoLocal = winston.format.combine(
  winston.format.colorize(),
  winston.format.timestamp({ format: 'HH:mm:ss.SSS' }),
  winston.format.printf(({ timestamp, level, message, servicio, nodo, ...meta }) => {
    const detalle = Object.keys(meta).length ? ` ${JSON.stringify(meta)}` : '';
    return `${timestamp} [${nodo}] [${level}] ${message}${detalle}`;
  })
);

const formatoJson = winston.format.combine(winston.format.timestamp(), winston.format.json());

const logger = winston.createLogger({
  level: config.logLevel,
  defaultMeta: { servicio: config.serviceName, nodo: config.raftNodoId },
  format: winston.format.errors({ stack: true }),
  transports: [
    new winston.transports.Console({
      format: process.env.NODE_ENV === 'production' ? formatoJson : formatoLocal,
    }),
  ],
});

module.exports = logger;
