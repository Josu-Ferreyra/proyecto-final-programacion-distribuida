const { client } = require('./redisClient');

// GET+DEL por separado tendría el mismo problema que el lock intenta resolver,
// por eso va como script Lua (Redis lo ejecuta atómico).
const UNLOCK_SCRIPT = `
if redis.call("GET", KEYS[1]) == ARGV[1] then
  return redis.call("DEL", KEYS[1])
else
  return 0
end
`;

function keyDeLock(recurso) {
  return `lock:${recurso}`;
}

async function acquireLock(recurso, ownerId, ttlMs) {
  const resultado = await client.set(keyDeLock(recurso), ownerId, {
    NX: true, // solo setea si la key no existe -> exclusión mutua
    PX: ttlMs, // TTL en milisegundos
  });
  return resultado === 'OK';
}

async function releaseLock(recurso, ownerId) {
  const resultado = await client.eval(UNLOCK_SCRIPT, {
    keys: [keyDeLock(recurso)],
    arguments: [ownerId],
  });
  return resultado === 1;
}

module.exports = { acquireLock, releaseLock, keyDeLock };
