const { createClient } = require('redis');

const client = createClient({
  socket: {
    host: process.env.REDIS_HOST || '127.0.0.1',
    port: Number(process.env.REDIS_PORT) || 6379,
  },
  password: process.env.REDIS_PASSWORD || undefined,
});

client.on('error', (err) => {
  console.error('Error de conexión con Redis/Memurai:', err.message);
});

let conectando;

function conectar() {
  if (!conectando) {
    conectando = client.connect();
  }
  return conectando;
}

module.exports = { client, conectar };
