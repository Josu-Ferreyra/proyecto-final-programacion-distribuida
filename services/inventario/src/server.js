// Arranque de UN nodo del cluster de Inventario. Los tres nodos son el mismo código:
// lo que cambia es RAFT_NODO_ID y MONGODB_URI (y CLUSTER_FILE según el entorno).
//
//   npm start                       (lee .env si existe)
//   docker compose up               (las variables las pasa compose.yml)

const http = require('node:http');
const mongoose = require('mongoose');
const config = require('./config/env');
const logger = require('./config/logger');
const { conectarConReintentos } = require('./config/db');
const { cargarTopologia } = require('./config/cluster');
const { crearNodoRaft } = require('./raft');
const stateMachine = require('./stock/stateMachine');
const { crearStockService } = require('./stock/services/stockService');
const { crearCatalogoClient } = require('./clients/catalogoClient');
const { crearRedisClient } = require('./lib/redisClient');
const { crearLock } = require('./lib/lock');
const { crearReenviarAlLeader } = require('./middlewares/reenviarAlLeader');
const { crearAuth } = require('./middlewares/auth');
const { crearApp } = require('./app');

async function main() {
  const cluster = cargarTopologia({ archivo: config.clusterFile, nodoId: config.raftNodoId, puerto: config.port });
  logger.info('Iniciando nodo de Inventario', {
    operacion: 'arranque',
    topologia: cluster.archivo,
    apiPort: cluster.nodo.apiHttpPort,
    raftPort: cluster.nodo.raftPort,
    peers: cluster.peers.map((p) => p.id),
  });

  await conectarConReintentos(config.mongodbUri);
  await mongoose.syncIndexes(); // índices únicos (productoId, referencia, índice del log)

  const raft = crearNodoRaft({ cluster, aplicar: stateMachine.aplicar, logger, config: config.raft });
  await raft.iniciar();

  const catalogo = crearCatalogoClient({ baseUrl: config.catalogoServiceUrl, timeoutMs: config.httpTimeoutMs, logger });
  const redis = crearRedisClient({ url: config.redisUrl, logger });
  const lock = crearLock({ client: redis, ttlMs: config.lockTtlMs, esperaMs: config.lockEsperaMs, logger });
  const stockService = crearStockService({ raft, catalogo, lock, config, logger });

  const soloEscrituraEnLeader = crearReenviarAlLeader({ raft, config, logger });

  const auth = crearAuth({ secret: config.jwtSecret, issuer: config.jwtIssuer, serviceName: config.serviceName, logger });

  const app = crearApp({ config, logger, raft, stockService, soloEscrituraEnLeader, auth });
  const servidor = http.createServer(app);
  await new Promise((resolve, reject) => {
    servidor.once('error', reject);
    servidor.listen(cluster.nodo.apiHttpPort, resolve);
  });
  logger.info(`API escuchando en el puerto ${cluster.nodo.apiHttpPort} (docs: /api-docs)`, { operacion: 'arranque' });

  // Recién con los puertos abiertos arranca el election timer.
  await raft.escuchar();

  let cerrando = false;
  const apagar = async (senial) => {
    if (cerrando) return;
    cerrando = true;
    logger.info('Deteniendo nodo', { operacion: 'apagado', senial });
    raft.detener();
    servidor.close();
    await redis.quit().catch(() => {});
    await mongoose.disconnect();
    process.exit(0);
  };
  process.on('SIGINT', () => apagar('SIGINT'));
  process.on('SIGTERM', () => apagar('SIGTERM'));
}

main().catch((err) => {
  logger.error('Error fatal al iniciar el nodo', { operacion: 'arranque', error: err.message });
  process.exit(1);
});
