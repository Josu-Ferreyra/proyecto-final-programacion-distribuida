// Cliente de los RPC internos de Raft (HTTP entre nodos, puerto raftPort).
// El timeout se recibe por parámetro: el módulo no lee variables de entorno.

function crearRpcClient({ timeoutMs = 1500 } = {}) {
  async function llamar(peer, ruta, cuerpo) {
    const res = await fetch(`${peer.raftUrl}${ruta}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(cuerpo),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) {
      throw new Error(`RPC ${ruta} a ${peer.id} respondió HTTP ${res.status}`);
    }
    return res.json();
  }

  return {
    requestVote: (peer, cuerpo) => llamar(peer, '/raft/request-vote', cuerpo),
    appendEntries: (peer, cuerpo) => llamar(peer, '/raft/append-entries', cuerpo),
  };
}

module.exports = { crearRpcClient };
