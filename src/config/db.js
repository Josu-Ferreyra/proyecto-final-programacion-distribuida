const dns = require('dns');
const mongoose = require('mongoose');
const logger = require('../lib/logger');

// Algunos DNS domésticos no resuelven los registros SRV que usan las URIs
// mongodb+srv:// de Atlas (querySrv ETIMEOUT). DNS_SERVERS permite forzar otros.
if (process.env.DNS_SERVERS) {
  dns.setServers(process.env.DNS_SERVERS.split(',').map((s) => s.trim()));
}

// Cada nodo usa su propia base (dbName), aunque compartan el mismo servidor Mongo:
// tp4_nodo1, tp4_nodo2, tp4_nodo3. El nombre de base que venga en la URI se ignora.
async function connectDB(dbName) {
  const uri = process.env.MONGODB_URI;

  mongoose.connection.on('disconnected', () => {
    logger.warn('Conexión a MongoDB perdida');
  });

  try {
    await mongoose.connect(uri, { dbName });
    logger.info('Conectado a MongoDB', { db: mongoose.connection.name });
  } catch (err) {
    logger.error('No se pudo conectar a MongoDB', { error: err.message });
    process.exit(1);
  }
}

module.exports = { connectDB };
