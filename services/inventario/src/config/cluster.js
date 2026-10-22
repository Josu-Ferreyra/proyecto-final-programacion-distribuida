// Topología del cluster de Inventario.
//
// En el TP4 había un cluster.json fijo con 127.0.0.1. Ahora el archivo se elige con
// CLUSTER_FILE (cluster.local.json para npm start, cluster.docker.json en Compose) y
// este proceso se identifica con RAFT_NODO_ID. Así el mismo código corre en los dos
// entornos cambiando solo configuración.

const fs = require('node:fs');
const path = require('node:path');

const RAIZ_SERVICIO = path.join(__dirname, '..', '..');

function leerArchivo(archivo) {
  const ruta = path.isAbsolute(archivo) ? archivo : path.join(RAIZ_SERVICIO, archivo);
  let contenido;
  try {
    contenido = JSON.parse(fs.readFileSync(ruta, 'utf8'));
  } catch (err) {
    throw new Error(`No se pudo leer la topología del cluster en "${ruta}": ${err.message}`);
  }
  if (!Array.isArray(contenido.nodos) || contenido.nodos.length === 0) {
    throw new Error(`La topología "${ruta}" no tiene una lista "nodos"`);
  }
  return { ruta, nodos: contenido.nodos };
}

function conUrls(n) {
  return {
    id: n.id,
    host: n.host,
    apiHttpPort: n.apiHttpPort,
    raftPort: n.raftPort,
    apiUrl: `http://${n.host}:${n.apiHttpPort}`,
    raftUrl: `http://${n.host}:${n.raftPort}`,
  };
}

// Devuelve { nodo, peers } para el proceso actual.
function cargarTopologia({ archivo, nodoId, puerto }) {
  const { ruta, nodos } = leerArchivo(archivo);
  const ids = nodos.map((n) => n.id).join(', ');

  const propio = nodos.find((n) => n.id === nodoId);
  if (!propio) {
    throw new Error(`RAFT_NODO_ID="${nodoId}" no existe en ${ruta} (ids válidos: ${ids})`);
  }
  if (puerto !== undefined && puerto !== propio.apiHttpPort) {
    throw new Error(
      `PORT=${puerto} no coincide con el apiHttpPort ${propio.apiHttpPort} de ${nodoId} en ${ruta}. ` +
        'Corregí la variable o el archivo de topología.'
    );
  }

  return {
    archivo: ruta,
    nodo: conUrls(propio),
    peers: nodos.filter((n) => n.id !== nodoId).map(conUrls),
  };
}

// Para los scripts de diagnóstico: todos los nodos con sus URLs.
function nodosDe(archivo) {
  return leerArchivo(archivo).nodos.map(conUrls);
}

module.exports = { cargarTopologia, nodosDe };
