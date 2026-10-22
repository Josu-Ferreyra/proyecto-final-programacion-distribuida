// Tabla con el estado Raft de los nodos de Inventario, consultando solo la API pública
// de diagnóstico (/api/cluster/estado), nunca los RPC internos.
//
//   node scripts/estado-cluster.js                       (topología local)
//   CLUSTER_FILE=otro.json node scripts/estado-cluster.js
//
// Contra Compose sirve la topología local: los puertos publicados al host son los
// mismos (3201-3203).

const { nodosDe } = require('../src/config/cluster');

const nodos = nodosDe(process.env.CLUSTER_FILE || 'cluster.local.json');

async function estadoDe(nodo) {
  try {
    const res = await fetch(`${nodo.apiUrl}/api/cluster/estado`, { signal: AbortSignal.timeout(2000) });
    return await res.json();
  } catch {
    return null;
  }
}

async function main() {
  const filas = [];
  let leader = null;
  for (const nodo of nodos) {
    const e = await estadoDe(nodo);
    if (!e) {
      filas.push({ nodo: nodo.id, rol: 'CAÍDO / sin respuesta' });
      continue;
    }
    if (e.rol === 'LEADER') leader = e;
    filas.push({
      nodo: e.nodo,
      rol: e.rol,
      termino: e.termino,
      leader: e.leaderConocido ? e.leaderConocido.id : '-',
      ultimoIndice: e.log.ultimoIndice,
      commitIndex: e.log.commitIndex,
      lastApplied: e.log.lastApplied,
    });
  }
  console.log(`Estado del cluster de Inventario - ${new Date().toLocaleTimeString()}`);
  console.table(filas);
  if (leader && leader.replicacion) {
    console.log(`Replicación vista por el Leader (${leader.nodo}):`);
    console.table(leader.replicacion);
  }
}

main();
