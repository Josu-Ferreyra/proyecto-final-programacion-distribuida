// Referencia al RaftNode de este proceso, para que los controllers de la API lo usen
// sin tener que pasarlo por parámetro. La setea server.js al arrancar.
let raft = null;

function setRaft(instancia) {
  raft = instancia;
}

function getRaft() {
  if (!raft) throw new Error('El nodo Raft todavía no fue inicializado');
  return raft;
}

module.exports = { setRaft, getRaft };
