// Toda la configuración sale de variables de entorno: el mismo código corre con
// `npm start` (valores del .env) y en Docker Compose (valores de compose.yml).
// No hay URLs ni hosts escritos en el código.

function entero(nombre, porDefecto, { min = 1 } = {}) {
  const valor = process.env[nombre];
  if (valor === undefined || valor === '') return porDefecto;
  const numero = Number(valor);
  if (!Number.isInteger(numero) || numero < min) {
    throw new Error(`La variable ${nombre} debe ser un entero >= ${min} (valor actual: "${valor}")`);
  }
  return numero;
}

function obligatoria(nombre) {
  const valor = process.env[nombre];
  if (!valor) throw new Error(`Falta la variable de entorno ${nombre} (ver .env.example)`);
  return valor;
}

const config = Object.freeze({
  serviceName: process.env.SERVICE_NAME || 'inventario-service',
  // Si se define, tiene que coincidir con el apiHttpPort del nodo en CLUSTER_FILE.
  port: process.env.PORT ? entero('PORT') : undefined,
  logLevel: process.env.LOG_LEVEL || 'info',

  mongodbUri: obligatoria('MONGODB_URI'),
  mongodbIntentos: entero('MONGODB_CONNECT_RETRIES', 10),
  mongodbEsperaMs: entero('MONGODB_RETRY_MS', 3000),

  raftNodoId: obligatoria('RAFT_NODO_ID'),
  clusterFile: obligatoria('CLUSTER_FILE'),
  raft: {
    commitTimeoutMs: entero('RAFT_COMMIT_TIMEOUT_MS', 2500), // D3: menor que los 3000 de Ventas
    electionTimeoutMinMs: entero('RAFT_ELECTION_TIMEOUT_MIN_MS', 3000),
    electionTimeoutMaxMs: entero('RAFT_ELECTION_TIMEOUT_MAX_MS', 6000),
    heartbeatMs: entero('RAFT_HEARTBEAT_MS', 1000),
    rpcTimeoutMs: entero('RAFT_RPC_TIMEOUT_MS', 1500),
    maxEntradasPorMensaje: entero('RAFT_MAX_ENTRADAS_POR_MENSAJE', 50),
  },

  catalogoServiceUrl: obligatoria('CATALOGO_SERVICE_URL'),
  httpTimeoutMs: entero('HTTP_TIMEOUT_MS', 3000),

  redisUrl: obligatoria('REDIS_URL'),
  lockTtlMs: entero('LOCK_TTL_MS', 5000),
  lockEsperaMs: entero('LOCK_WAIT_MS', 400, { min: 0 }),
  // Demora artificial dentro de la sección crítica del descuento (pruebas de fallos).
  descuentoDelayMs: entero('DESCUENTO_DELAY_MS', 0, { min: 0 }),
});

module.exports = config;
