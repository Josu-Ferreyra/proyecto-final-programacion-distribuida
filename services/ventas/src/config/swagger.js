const config = require('./env');
const { ESTADOS } = require('../models/compra.model');

// Especificación OpenAPI escrita como objeto (y no con comentarios en las rutas),
// igual que en Catálogo. Los estados salen del mismo módulo que usa el schema.
const json = (schema) => ({ 'application/json': { schema } });
const ref = (nombre) => ({ $ref: `#/components/schemas/${nombre}` });
const respuesta = (nombre) => ({ $ref: `#/components/responses/${nombre}` });

const parametroCompraId = {
  in: 'path',
  name: 'id',
  required: true,
  schema: { type: 'string' },
  description: 'compraId (ObjectId de MongoDB generado por Ventas)',
  example: '65f1a2b3c4d5e6f7a8b9c0d1',
};

const spec = {
  openapi: '3.0.3',
  info: {
    title: 'Servicio de Ventas - TP6 Programación Distribuida',
    version: '1.0.0',
    description:
      'Concreta las compras de los clientes y lleva su ciclo de vida, dejando constancia de qué se compró, ' +
      'cuánto y a qué precio.\n\n' +
      'Ventas no guarda ni consulta stock: lo pide a Inventario. Tampoco guarda precios vigentes: ' +
      'los consulta a Catálogo y los congela en cada ítem al confirmar la compra.',
  },
  // Relativo: Swagger UI llama al mismo host y puerto desde el que se abrió.
  servers: [{ url: '/', description: config.serviceName }],
  tags: [
    { name: 'Compras', description: 'Registro y ciclo de vida de las compras' },
    { name: 'Salud', description: 'Estado del proceso' },
  ],
  paths: {
    '/health': {
      get: {
        tags: ['Salud'],
        summary: 'Indica que el proceso está vivo (no consulta la base ni las dependencias)',
        responses: { 200: { description: 'Proceso vivo', content: json(ref('Health')) } },
      },
    },
    '/compras/{id}': {
      get: {
        tags: ['Compras'],
        summary: 'Consultar una compra',
        description: 'Lee solo la base de Ventas: no llama a Catálogo ni a Inventario.',
        parameters: [parametroCompraId],
        responses: {
          200: { description: 'Compra encontrada', content: json(ref('Compra')) },
          400: respuesta('SolicitudInvalida'),
          404: respuesta('NoEncontrada'),
          503: respuesta('NoDisponible'),
        },
      },
    },
  },
  components: {
    schemas: {
      Health: {
        type: 'object',
        properties: {
          service: { type: 'string', example: 'ventas-service' },
          status: { type: 'string', example: 'ok' },
        },
      },
      Item: {
        type: 'object',
        properties: {
          productoId: { type: 'string', example: '65f1a2b3c4d5e6f7a8b9c0aa' },
          nombreProducto: { type: 'string', example: 'Teclado mecánico', description: 'Copia del nombre al momento de la compra' },
          precioUnitario: { type: 'number', example: 25000, description: 'Precio pagado: copia del precio vigente al confirmar' },
          cantidad: { type: 'integer', minimum: 1, example: 2 },
        },
      },
      Compra: {
        type: 'object',
        properties: {
          compraId: { type: 'string', example: '65f1a2b3c4d5e6f7a8b9c0d1' },
          estado: { type: 'string', enum: Object.values(ESTADOS) },
          reintegroPendiente: {
            type: 'boolean',
            description: 'true si quedó un reintegro de stock sin confirmar (compra FALLIDA, decisión D7)',
          },
          items: { type: 'array', items: ref('Item') },
          total: { type: 'number', example: 50000 },
          motivoFallo: { type: 'string', description: 'Solo en compras FALLIDA' },
          fecha: { type: 'string', format: 'date-time' },
          actualizada: { type: 'string', format: 'date-time' },
        },
      },
      Error: {
        type: 'object',
        properties: {
          error: { type: 'string' },
          servicio: { type: 'string', example: 'ventas-service', description: 'Servicio que generó el error' },
        },
      },
    },
    responses: {
      SolicitudInvalida: { description: 'Datos o identificador inválidos', content: json(ref('Error')) },
      NoEncontrada: { description: 'La compra no existe', content: json(ref('Error')) },
      NoDisponible: { description: 'La base de Ventas no está disponible', content: json(ref('Error')) },
    },
  },
};

module.exports = spec;
