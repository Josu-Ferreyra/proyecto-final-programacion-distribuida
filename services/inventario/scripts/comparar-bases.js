// Lee directo las bases de los nodos de Inventario y dice si convergen.
//
// Accede a Mongo sin pasar por la API (observación 10 del inventario del TP5). Es válido
// porque son las bases de ESTE servicio: ningún otro servicio usa este script.
//
//   node scripts/comparar-bases.js
//   MONGODB_SERVER=mongodb://127.0.0.1:27017 node scripts/comparar-bases.js
//
// Contra Compose (Mongo no se publica al host):
//   docker compose exec inventario-1 node scripts/comparar-bases.js
//   (con MONGODB_SERVER=mongodb://inventario-db:27017, que el script toma de MONGODB_URI)

const mongoose = require('mongoose');

const BASES = (process.env.INVENTARIO_BASES || 'inventario_nodo1,inventario_nodo2,inventario_nodo3').split(',');

function servidor() {
  if (process.env.MONGODB_SERVER) return process.env.MONGODB_SERVER;
  if (process.env.MONGODB_URI) {
    const url = new URL(process.env.MONGODB_URI);
    return `${url.protocol}//${url.host}`;
  }
  return 'mongodb://127.0.0.1:27017';
}

async function resumen(conn) {
  const db = conn.db;
  const stock = await db.collection('stock').find({}, { projection: { _id: 0, productoId: 1, cantidad: 1 } }).sort({ productoId: 1 }).toArray();
  const descuentos = await db.collection('descuentos').countDocuments();
  const movimientos = await db.collection('movimientos').countDocuments();
  const estado = (await db.collection('raft_estado').findOne({ _id: 'estado' })) || {};
  return { stock, descuentos, movimientos, lastApplied: estado.lastApplied || 0, termino: estado.currentTerm || 0 };
}

async function main() {
  const uri = servidor();
  const resultados = {};
  for (const base of BASES) {
    const conn = await mongoose.createConnection(uri, { dbName: base, serverSelectionTimeoutMS: 3000 }).asPromise();
    resultados[base] = await resumen(conn);
    await conn.close();
  }

  console.table(
    Object.entries(resultados).map(([base, r]) => ({
      base,
      termino: r.termino,
      lastApplied: r.lastApplied,
      productos: r.stock.length,
      unidades: r.stock.reduce((t, s) => t + s.cantidad, 0),
      descuentos: r.descuentos,
      movimientos: r.movimientos,
    }))
  );

  const firmas = Object.values(resultados).map((r) => JSON.stringify([r.stock, r.descuentos, r.movimientos]));
  const convergen = firmas.every((f) => f === firmas[0]);
  console.log(convergen ? 'CONVERGEN: las bases tienen el mismo stock, descuentos y movimientos' : 'NO CONVERGEN (¿algún nodo atrasado o caído?)');
  process.exit(convergen ? 0 : 1);
}

main().catch((err) => {
  console.error('Error comparando las bases:', err.message);
  process.exit(2);
});
