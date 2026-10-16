const express = require('express');
const swaggerUi = require('swagger-ui-express');
const productosRouter = require('./routes/productos.routes');
const clusterRouter = require('./routes/cluster.routes');
const { crearSpec } = require('./docs/swagger');
const logger = require('./lib/logger');

// API externa (negocio + diagnóstico). Los RPC de Raft viven en otra app/puerto
// (src/raft/raftApp.js).
function crearApp(nodo) {
  const app = express();
  const openapiSpec = crearSpec(nodo);

  app.use(express.json());

  app.use((req, res, next) => {
    const inicio = Date.now();
    res.set('X-Raft-Nodo', nodo.id);
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

  app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(openapiSpec));
  app.get('/api-docs.json', (req, res) => res.json(openapiSpec));

  app.use('/api/productos', productosRouter);
  app.use('/api/cluster', clusterRouter);

  app.use((req, res) => {
    res.status(404).json({ error: 'Ruta no encontrada' });
  });

  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    if (err.type === 'entity.parse.failed') {
      logger.warn('Request rechazada: JSON malformado', { url: req.originalUrl, error: err.message });
      return res.status(400).json({ error: 'El body debe ser JSON válido' });
    }

    logger.error('Error no controlado', { error: err.message, stack: err.stack, url: req.originalUrl });
    res.status(500).json({ error: 'Error interno del servidor' });
  });

  return app;
}

module.exports = { crearApp };
