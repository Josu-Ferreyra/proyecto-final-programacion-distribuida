const { createClient } = require('redis');

// Cliente de Redis/Memurai para el lock interno de Inventario. La dirección sale de
// REDIS_URL: Memurai local en Windows, el contenedor "redis" en Compose. El código no
// depende de una instalación específica (sección 12.2 del TP6).
//
// disableOfflineQueue: si Redis está caído, los comandos fallan enseguida en lugar de
// quedar encolados esperando la reconexión (las escrituras responden 503 y las
// lecturas, que no usan el lock, siguen funcionando).
function crearRedisClient({ url, logger }) {
  const client = createClient({
    url,
    disableOfflineQueue: true,
    socket: {
      connectTimeout: 2000,
      reconnectStrategy: (intentos) => Math.min(intentos * 200, 2000),
    },
  });

  let disponible = false;
  client.on('ready', () => {
    if (!disponible) logger.info('Redis conectado', { operacion: 'redis.connect' });
    disponible = true;
  });
  client.on('error', (err) => {
    if (disponible) logger.warn('Conexión con Redis perdida', { operacion: 'redis.connection', error: err.message });
    disponible = false;
  });

  // No se espera: si Redis todavía no está listo, el nodo arranca igual y el cliente
  // sigue reintentando. Mientras tanto las escrituras responden 503.
  client.connect().catch((err) => logger.warn('Redis no disponible al arrancar', { operacion: 'redis.connect', error: err.message }));

  return client;
}

module.exports = { crearRedisClient };
