// Interfaz pública del módulo Raft. El resto del servicio usa solo esto.
//
// El módulo no sabe qué es un producto ni un stock (Caso 4 del TP5): recibe comandos
// opacos y la función aplicar(entrada) que provee el servicio. Tampoco lee variables
// de entorno ni importa un logger global: todo llega por parámetro.

const http = require('node:http');
const { RaftNode, ROLES, ErrorRaft } = require('./raftNode');
const { crearRaftApp } = require('./raftApp');
const { crearRpcClient } = require('./rpcClient');
const defaultStorage = require('./storage');

// cluster: { nodo: { id, host, apiUrl, raftUrl, raftPort }, peers: [{ id, apiUrl, raftUrl }] }
function crearNodoRaft({ cluster, aplicar, logger, config = {}, storage = defaultStorage }) {
  const { rpcTimeoutMs, ...configProtocolo } = config;
  const nodoRaft = new RaftNode({
    nodo: cluster.nodo,
    peers: cluster.peers,
    storage,
    aplicar,
    rpc: crearRpcClient({ timeoutMs: rpcTimeoutMs }),
    logger,
    config: configProtocolo,
  });

  let servidorRpc = null;

  return {
    async iniciar() {
      await nodoRaft.iniciar();
    },

    // Abre el puerto interno de RPC y arranca el election timer.
    async escuchar() {
      servidorRpc = http.createServer(crearRaftApp({ raft: nodoRaft, nodo: cluster.nodo, logger }));
      await new Promise((resolve, reject) => {
        servidorRpc.once('error', reject);
        servidorRpc.listen(cluster.nodo.raftPort, resolve);
      });
      logger.info(`RPC interno Raft escuchando en el puerto ${cluster.nodo.raftPort} (docs: /raft-docs)`, { operacion: 'arranque' });
      nodoRaft.arrancar();
    },

    detener() {
      nodoRaft.detener();
      if (servidorRpc) servidorRpc.close();
    },

    // Propone un comando y espera a que quede committed y aplicado en este nodo.
    // Devuelve { index, term, resultado } o lanza ErrorRaft (NO_SOY_LEADER, SIN_QUORUM,
    // LIDERAZGO_PERDIDO).
    proponer(comando) {
      return nodoRaft.proponer(comando);
    },

    esLeader: () => nodoRaft.esLeader(),
    leader: () => (nodoRaft.leaderId ? nodoRaft.infoNodo(nodoRaft.leaderId) : null),
    estado: () => nodoRaft.estado(),
    entradasLog: (opciones) => nodoRaft.entradasLog(opciones),
  };
}

module.exports = { crearNodoRaft, ROLES, ErrorRaft };
