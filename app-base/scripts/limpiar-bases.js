// Borra las tres bases del cluster (tp4_nodo1/2/3) para empezar de cero.
// OJO: pierde productos, log y término. Solo para reiniciar el laboratorio, con los
// nodos APAGADOS.
//
// Uso: npm run limpiar -- --si

require('dotenv').config({ quiet: true });
const dns = require('dns');
const mongoose = require('mongoose');
const { nodos } = require('./lib/cliente-cluster');

if (process.env.DNS_SERVERS) dns.setServers(process.env.DNS_SERVERS.split(',').map((s) => s.trim()));

const PREFIJO = process.env.MONGODB_DB_PREFIX || 'tp4_';

async function main() {
  if (!process.argv.includes('--si')) {
    console.log(`Esto borra las bases ${nodos.map((n) => PREFIJO + n.id).join(', ')}. Confirmá con: npm run limpiar -- --si`);
    process.exit(1);
  }

  for (const nodo of nodos) {
    const dbName = `${PREFIJO}${nodo.id}`;
    const conn = await mongoose.createConnection(process.env.MONGODB_URI, { dbName }).asPromise();
    await conn.dropDatabase();
    await conn.close();
    console.log(`Base ${dbName} eliminada`);
  }
}

main().catch((err) => {
  console.error('Error limpiando bases:', err.message);
  process.exit(1);
});
