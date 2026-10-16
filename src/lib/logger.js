const path = require('path');
const winston = require('winston');
require('winston-daily-rotate-file');

// server.js resuelve la identidad del nodo antes de requerir el logger, así que
// NODE_ID ya está disponible acá. Cada nodo escribe en su propia carpeta
// (logs/nodo1, logs/nodo2, logs/nodo3) y cada línea lleva el campo "nodo".
const NODE_ID = process.env.NODE_ID || 'sin-nodo';
const LOG_DIR = path.join(process.env.LOG_DIR || 'logs', NODE_ID);
const LOG_LEVEL = process.env.LOG_LEVEL || 'info';
const LOG_MAX_SIZE = process.env.LOG_MAX_SIZE || '20m';
const LOG_MAX_FILES = process.env.LOG_MAX_FILES || '14d';

const baseFormat = winston.format.combine(
  winston.format.timestamp(),
  winston.format.errors({ stack: true }),
  winston.format.json()
);

// Un archivo con todos los niveles y otro solo con errores, ambos con
// rotacion diaria + rotacion por tamanio y una politica de retencion limitada
// (LOG_MAX_FILES borra automaticamente lo que se pasa de esa antiguedad/cantidad).
const appFileTransport = new winston.transports.DailyRotateFile({
  dirname: LOG_DIR,
  filename: 'app-%DATE%.log',
  datePattern: 'YYYY-MM-DD',
  maxSize: LOG_MAX_SIZE,
  maxFiles: LOG_MAX_FILES,
});

const errorFileTransport = new winston.transports.DailyRotateFile({
  dirname: LOG_DIR,
  filename: 'error-%DATE%.log',
  datePattern: 'YYYY-MM-DD',
  level: 'error',
  maxSize: LOG_MAX_SIZE,
  maxFiles: LOG_MAX_FILES,
});

const logger = winston.createLogger({
  level: LOG_LEVEL,
  format: baseFormat,
  defaultMeta: { nodo: NODE_ID },
  transports: [appFileTransport, errorFileTransport],
});

if (process.env.NODE_ENV !== 'production') {
  logger.add(
    new winston.transports.Console({
      format: winston.format.combine(
        winston.format.colorize(),
        winston.format.timestamp({ format: 'HH:mm:ss.SSS' }),
        winston.format.printf(({ timestamp, level, message, nodo, ...meta }) => {
          const metaStr = Object.keys(meta).length ? ` ${JSON.stringify(meta)}` : '';
          return `${timestamp} [${nodo}] [${level}] ${message}${metaStr}`;
        })
      ),
    })
  );
}

module.exports = logger;
module.exports.logDir = path.resolve(LOG_DIR);
