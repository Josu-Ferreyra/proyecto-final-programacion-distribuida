// Compara DIRECTAMENTE las tres bases Mongo (tp4_nodo1/2/3), sin pasar por la API,
// para comprobar que las réplicas convergen. Solo lee.
//
// Uso: npm run comparar

require('dotenv').config({ quiet: true });
const dns = require('dns');
const mongoose = require('mongoose');
const { nodos } = require('./lib/cliente-cluster');

if (process.env.DNS_SERVERS) dns.setServers(process.env.DNS_SERVERS.split(',').map((s) => s.trim()));

const PREFIJO = process.env.MONGODB_DB_PREFIX || 'tp4_';

function huella(productos) {
  return JSON.stringify(productos.map((p) => [String(p._id), p.nombre, p.precio, p.stock, p.categoria, p.version]));
}

async function main() {
  const resumen = [];
  const huellas = {};

  for (const nodo of nodos) {
    const dbName = `${PREFIJO}${nodo.id}`;
    const conn = await mongoose.createConnection(process.env.MONGODB_URI, { dbName }).asPromise();
    const productos = await conn.db.collection('productos').find().sort({ _id: 1 }).toArray();
    const estado = (await conn.db.collection('raft_estado').findOne({ _id: 'estado' })) || {};
    const entradas = await conn.db.collection('raft_log').countDocuments();
    await conn.close();

    huellas[nodo.id] = huella(productos);
    resumen.push({
      nodo: nodo.id,
      db: dbName,
      currentTerm: estado.currentTerm,
      votedFor: estado.votedFor,
      entradasLog: entradas,
      commitIndex: estado.commitIndex,
      lastApplied: estado.lastApplied,
      productos: productos.length,
    });

    console.log(`\n${dbName}.productos`);
    console.table(
      productos.map((p) => ({
        id: String(p._id),
        nombre: p.nombre,
        precio: p.precio,
        stock: p.stock,
        version: p.version,
        ultimoIndiceRaft: p.ultimoIndiceRaft,
      }))
    );
  }

  console.log('\nEstado Raft persistido en cada base:');
  console.table(resumen);

  const distintas = new Set(Object.values(huellas));
  console.log(
    distintas.size === 1
      ? 'CONVERGEN: las tres bases tienen exactamente los mismos productos (id, datos y versión).'
      : 'NO CONVERGEN (todavía): hay diferencias entre las bases. Puede ser un nodo caído o atrasado.'
  );
}

main().catch((err) => {
  console.error('Error comparando bases:', err.message);
  process.exit(1);
});
