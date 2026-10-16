// Cliente de los RPC internos de Raft (HTTP entre nodos, puerto raftPort).

const RPC_TIMEOUT_MS = Number(process.env.RAFT_RPC_TIMEOUT_MS) || 1500;

async function llamar(peer, ruta, cuerpo) {
  const res = await fetch(`${peer.raftUrl}${ruta}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(cuerpo),
    signal: AbortSignal.timeout(RPC_TIMEOUT_MS),
  });
  if (!res.ok) {
    throw new Error(`RPC ${ruta} a ${peer.id} respondió HTTP ${res.status}`);
  }
  return res.json();
}

function requestVote(peer, cuerpo) {
  return llamar(peer, '/raft/request-vote', cuerpo);
}

function appendEntries(peer, cuerpo) {
  return llamar(peer, '/raft/append-entries', cuerpo);
}

module.exports = { requestVote, appendEntries };
