const express = require('express');
const swaggerUi = require('swagger-ui-express');
const config = require('./config/env');
const logger = require('./config/logger');
const spec = require('./config/swagger');
const { requiereDb, esErrorDeConexion } = require('./config/db');
const { ErrorCatalogo } = require('./services/errores');
const healthRouter = require('./routes/health.routes');
const productosRouter = require('./routes/productos.routes');
const categoriasRouter = require('./routes/categorias.routes');

// "Operación" en los logs: método y path del pedido, sin la query.
function endpoint(req) {
  return `${req.method} ${req.originalUrl.split('?')[0]}`;
}

function crearApp() {
  const app = express();

  app.use(express.json());

  app.use((req, res, next) => {
    const inicio = Date.now();
    res.on('finish', () => {
      logger.info('Request', {
        method: req.method,
        url: req.originalUrl,
        status: res.statusCode,
        ms: Date.now() - inicio,
      });
    });
    next();
  });

  app.use('/health', healthRouter);
  app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(spec));
  app.get('/api-docs.json', (req, res) => res.json(spec));

  app.use('/productos', requiereDb, productosRouter);
  app.use('/categorias', categoriasRouter);

  app.use((req, res) => {
    res.status(404).json({ error: 'Ruta no encontrada', servicio: config.serviceName });
  });

  // Ningún error de una dependencia termina en un 500 genérico: los de negocio salen
  // con su código y la base caída con 503.
  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    const servicio = config.serviceName;

    if (err.type === 'entity.parse.failed') {
      logger.warn('Request rechazada: JSON malformado', { operacion: endpoint(req), error: err.message });
      return res.status(400).json({ error: 'El body debe ser JSON válido', servicio });
    }

    if (err instanceof ErrorCatalogo) {
      logger.warn('Request rechazada', { operacion: endpoint(req), status: err.status, error: err.message });
      return res.status(err.status).json({ error: err.message, servicio });
    }

    if (esErrorDeConexion(err)) {
      logger.error('Base de datos no disponible', { operacion: endpoint(req), error: err.message });
      return res.status(503).json({ error: 'Base de datos no disponible', servicio });
    }

    logger.error('Error no controlado', { operacion: endpoint(req), error: err.message, stack: err.stack });
    res.status(500).json({ error: 'Error interno del servidor', servicio });
  });

  return app;
}

module.exports = { crearApp };
