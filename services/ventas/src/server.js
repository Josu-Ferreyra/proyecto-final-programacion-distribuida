// Arranque del Servicio de Ventas: npm start (lee .env si existe) o la imagen Docker
// (las variables las pasa compose.yml).
const mongoose = require('mongoose');
const config = require('./config/env');
const logger = require('./config/logger');
const { conectarConReintentos } = require('./config/db');
const { Compra } = require('./models/compra.model');
const { crearApp } = require('./app');

async function main() {
  logger.info('Iniciando servicio', { operacion: 'arranque', puerto: config.port });

  await conectarConReintentos(config.mongodbUri);
  await Compra.syncIndexes(); // índices por estado (los usa el proceso de reintentos)

  const servidor = crearApp().listen(config.port, () => {
    logger.info(`API escuchando en el puerto ${config.port} (docs: /api-docs)`, { operacion: 'arranque' });
  });

  let cerrando = false;
  const apagar = async (senial) => {
    if (cerrando) return;
    cerrando = true;
    logger.info('Deteniendo servicio', { operacion: 'apagado', senial });
    servidor.close();
    await mongoose.disconnect();
    process.exit(0);
  };
  process.on('SIGINT', () => apagar('SIGINT'));
  process.on('SIGTERM', () => apagar('SIGTERM'));
}

main().catch((err) => {
  logger.error('Error fatal al iniciar el servicio', { operacion: 'arranque', error: err.message });
  process.exit(1);
});
