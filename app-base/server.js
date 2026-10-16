// Arranque de UN nodo del cluster. Los tres nodos son el mismo código:
//
//   node server.js --node nodo1     (o: npm run nodo1)
//   node server.js --node nodo2
//   node server.js --node nodo3
//
// Con la identidad se derivan de cluster.json los puertos (API externa HTTP/HTTPS y
// RPC interno de Raft), la base Mongo propia (tp4_<nodo>) y la lista de peers.

require('dotenv').config({ quiet: true });

const { cargarIdentidad } = require('./src/config/cluster');

let nodo;
try {
  nodo = cargarIdentidad(process.argv); // antes de requerir el logger (usa NODE_ID)
} catch (err) {
  console.error(err.message);
  process.exit(1);
}

const fs = require('fs');
const http = require('http');
const https = require('https');
const mongoose = require('mongoose');
const logger = require('./src/lib/logger');
const { connectDB } = require('./src/config/db');
const { crearApp } = require('./src/app');
const { crearRaftApp } = require('./src/raft/raftApp');
const { RaftNode } = require('./src/raft/raftNode');
const { setRaft } = require('./src/raft/instancia');
const storage = require('./src/raft/storage');
const stateMachine = require('./src/raft/stateMachine');
const rpc = require('./src/raft/rpcClient');

function escuchar(servidor, puerto, host) {
  return new Promise((resolve, reject) => {
    servidor.once('error', reject);
    servidor.listen(puerto, host, resolve);
  });
}

async function main() {
  logger.info('Iniciando nodo', {
    apiHttp: nodo.apiUrl,
    apiHttps: `https://${nodo.host}:${nodo.apiHttpsPort}`,
    raft: nodo.raftUrl,
    mongoDb: nodo.dbName,
    peers: nodo.peers.map((p) => `${p.id}@${p.raftUrl}`),
  });

  await connectDB(nodo.dbName);
  await mongoose.syncIndexes(); // índices (nombre único, index del log) en la base de este nodo

  const raft = new RaftNode({ nodo, storage, stateMachine, rpc });
  setRaft(raft);
  await raft.iniciar();

  const servidores = [];

  const raftServer = http.createServer(crearRaftApp(nodo));
  await escuchar(raftServer, nodo.raftPort, nodo.host);
  servidores.push(raftServer);
  logger.info(`RPC interno Raft escuchando en ${nodo.raftUrl} (docs: ${nodo.raftUrl}/raft-docs)`);

  const app = crearApp(nodo);

  const httpServer = http.createServer(app);
  await escuchar(httpServer, nodo.apiHttpPort, nodo.host);
  servidores.push(httpServer);
  logger.info(`API HTTP escuchando en ${nodo.apiUrl} (docs: ${nodo.apiUrl}/api-docs)`);

  const pfxPath = process.env.SSL_PFX_PATH;
  if (!pfxPath || !fs.existsSync(pfxPath)) {
    logger.warn(
      `No se encontró el certificado en "${pfxPath}". Corré scripts/generar-certificado.ps1 y configurá SSL_PFX_PATH en .env para levantar HTTPS.`
    );
  } else {
    const credentials = {
      pfx: fs.readFileSync(pfxPath),
      passphrase: process.env.SSL_PASSPHRASE || '',
    };
    const httpsServer = https.createServer(credentials, app);
    await escuchar(httpsServer, nodo.apiHttpsPort, nodo.host);
    servidores.push(httpsServer);
    logger.info(`API HTTPS escuchando en https://${nodo.host}:${nodo.apiHttpsPort}`);
  }

  // Recién con los puertos abiertos arranca el election timer.
  raft.arrancar();

  let cerrando = false;
  const apagar = async (senial) => {
    if (cerrando) return;
    cerrando = true;
    logger.info('Deteniendo nodo', { senial });
    raft.detener();
    servidores.forEach((s) => s.close());
    await mongoose.disconnect();
    process.exit(0);
  };
  process.on('SIGINT', () => apagar('SIGINT'));
  process.on('SIGTERM', () => apagar('SIGTERM'));
}

main().catch((err) => {
  logger.error('Error fatal al iniciar el nodo', { error: err.message, stack: err.stack });
  process.exit(1);
});
