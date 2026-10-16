// Helpers de los scripts: consultar el estado de los nodos y encontrar al Leader
// usando SOLO la API externa (nunca los RPC internos de Raft).

const { leerConfigCluster } = require('../../src/config/cluster');

const nodos = leerConfigCluster();

async function estadoDe(nodo) {
  try {
    const res = await fetch(`${nodo.apiUrl}/api/cluster/estado`, { signal: AbortSignal.timeout(2000) });
    return await res.json();
  } catch {
    return null; // caído / no responde
  }
}

async function estados() {
  return Promise.all(nodos.map(async (n) => ({ nodo: n, estado: await estadoDe(n) })));
}

// Espera hasta que algún nodo se reporte LEADER (o vence el tiempo).
async function buscarLeader({ esperaMs = 15000 } = {}) {
  const limite = Date.now() + esperaMs;
  while (Date.now() < limite) {
    const todos = await estados();
    const leader = todos.find((t) => t.estado && t.estado.rol === 'LEADER');
    if (leader) return leader.nodo;
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error('No se encontró un Leader (¿están levantados al menos 2 nodos?)');
}

module.exports = { nodos, estadoDe, estados, buscarLeader };
