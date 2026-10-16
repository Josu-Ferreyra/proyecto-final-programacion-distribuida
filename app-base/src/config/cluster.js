// Configuración común del cluster + identidad del proceso.
//
// Los tres procesos leen el mismo cluster.json. Lo único que cambia entre uno y otro
// es el nodeId con el que se arranca (--node nodo1 o NODE_ID=nodo1), y a partir de ahí
// se derivan los puertos (API externa / RPC interno de Raft), la base de Mongo y la
// lista de peers. Así no hay que tocar el código entre ejecuciones.

const fs = require('fs');
const path = require('path');

const RUTA_CONFIG = process.env.CLUSTER_CONFIG || path.join(__dirname, '..', '..', 'cluster.json');

function leerConfigCluster() {
  const config = JSON.parse(fs.readFileSync(RUTA_CONFIG, 'utf8'));
  const host = config.host || '127.0.0.1';

  return Object.entries(config.nodos).map(([id, nodo]) => ({
    id,
    host,
    apiHttpPort: nodo.apiHttpPort,
    apiHttpsPort: nodo.apiHttpsPort,
    raftPort: nodo.raftPort,
    apiUrl: `http://${host}:${nodo.apiHttpPort}`,
    raftUrl: `http://${host}:${nodo.raftPort}`,
  }));
}

function nodeIdDeArgumentos(argv) {
  const i = argv.indexOf('--node');
  if (i !== -1 && argv[i + 1]) return argv[i + 1];
  const conIgual = argv.find((a) => a.startsWith('--node='));
  if (conIgual) return conIgual.split('=')[1];
  return process.env.NODE_ID;
}

// Resuelve quién es este proceso. Deja NODE_ID en process.env para que el logger
// (que se configura al requerirse) pueda separar los logs por nodo.
function cargarIdentidad(argv = process.argv) {
  const nodos = leerConfigCluster();
  const nodeId = nodeIdDeArgumentos(argv);

  if (!nodeId) {
    throw new Error(`Falta la identidad del nodo. Usá --node <id> (ids válidos: ${nodos.map((n) => n.id).join(', ')})`);
  }

  const local = nodos.find((n) => n.id === nodeId);
  if (!local) {
    throw new Error(`Nodo "${nodeId}" no existe en ${RUTA_CONFIG} (ids válidos: ${nodos.map((n) => n.id).join(', ')})`);
  }

  process.env.NODE_ID = nodeId;

  const prefijoDb = process.env.MONGODB_DB_PREFIX || 'tp4_';

  return {
    ...local,
    dbName: `${prefijoDb}${nodeId}`,
    peers: nodos.filter((n) => n.id !== nodeId),
    tamanioCluster: nodos.length,
  };
}

module.exports = { cargarIdentidad, leerConfigCluster };
