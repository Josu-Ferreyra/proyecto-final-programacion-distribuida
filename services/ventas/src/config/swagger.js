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
    '/compras': {
      post: {
        tags: ['Compras'],
        summary: 'Registrar una compra de uno o varios productos (TP5 §6.5.1)',
        description:
          '1. Valida el formato del pedido.\n' +
          '2. **C1** `GET /productos?ids=…` a Catálogo: los productos tienen que existir y estar activos; ' +
          'se toman el nombre y el precio vigente.\n' +
          '3. **C2** `POST /descuentos` a Inventario con `referencia = compraId`: Inventario decide si alcanza el ' +
          'stock (todo o nada). Ventas nunca consulta el stock antes.\n' +
          '4. Guarda la compra `CONFIRMADA` con el precio pagado y el total.\n\n' +
          'Si Inventario no confirma a tiempo (timeout o 5xx), el descuento **pudo** haberse aplicado: Ventas lo ' +
          'compensa con **C3** `DELETE /descuentos/:compraId` y responde 503. Si la compensación no se puede ' +
          'confirmar, guarda la compra como `FALLIDA` con `reintegroPendiente` (D7) y la reintenta cada 30 s.',
        requestBody: {
          required: true,
          content: json(ref('NuevaCompra')),
        },
        responses: {
          201: { description: 'Compra confirmada', content: json(ref('Compra')) },
          400: {
            description: 'Formato inválido, o productos inexistentes en Catálogo (`productosInexistentes`)',
            content: json(ref('ErrorProductosInexistentes')),
          },
          409: {
            description:
              'Productos dados de baja (`productosInactivos`), stock insuficiente (`faltantes`) u otro conflicto informado por Inventario',
            content: json(ref('ErrorConflictoCompra')),
          },
          502: { description: 'Catálogo o Inventario respondieron algo inesperado', content: json(ref('ErrorDependencia')) },
          503: {
            description:
              'Catálogo o Inventario no disponibles (timeout, DNS, conexión rechazada o 503), o la base de Ventas caída. ' +
              'Nada queda confirmado; si hubo que compensar se informan `compraId` y `compensacion`.',
            content: json(ref('ErrorDependencia')),
          },
        },
      },
    },
    '/compras/{id}/cancelar': {
      patch: {
        tags: ['Compras'],
        summary: 'Cancelar una compra (TP5 §6.5.2)',
        description:
          'Solo se cancela una compra `CONFIRMADA`. Ventas pide a Inventario el reintegro (**C3** ' +
          '`DELETE /descuentos/:compraId`). Si Inventario no responde, la compra queda en `CANCELACION_PENDIENTE` y ' +
          'el reintegro se reintenta cada 30 s hasta lograrlo.',
        parameters: [parametroCompraId],
        responses: {
          200: { description: 'Compra cancelada y stock reintegrado', content: json(ref('Cancelacion')) },
          202: { description: 'Inventario no disponible: la cancelación queda pendiente', content: json(ref('Cancelacion')) },
          400: respuesta('SolicitudInvalida'),
          404: respuesta('NoEncontrada'),
          409: { description: 'La compra no está CONFIRMADA (ya cancelada, cancelación en curso o FALLIDA)', content: json(ref('Error')) },
          503: respuesta('NoDisponible'),
        },
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
      NuevaCompra: {
        type: 'object',
        required: ['items'],
        properties: {
          items: {
            type: 'array',
            minItems: 1,
            maxItems: 50,
            description: 'Sin productoId repetidos',
            items: {
              type: 'object',
              required: ['productoId', 'cantidad'],
              properties: {
                productoId: { type: 'string', example: '65f1a2b3c4d5e6f7a8b9c0aa' },
                cantidad: { type: 'integer', minimum: 1, example: 2 },
              },
            },
          },
        },
      },
      Cancelacion: {
        type: 'object',
        properties: {
          compraId: { type: 'string', example: '65f1a2b3c4d5e6f7a8b9c0d1' },
          estado: { type: 'string', enum: [ESTADOS.CANCELADA, ESTADOS.CANCELACION_PENDIENTE] },
          mensaje: { type: 'string', description: 'Solo en 202' },
        },
      },
      Error: {
        type: 'object',
        properties: {
          error: { type: 'string' },
          servicio: { type: 'string', example: 'ventas-service', description: 'Servicio que generó el error' },
        },
      },
      ErrorProductosInexistentes: {
        allOf: [
          ref('Error'),
          { type: 'object', properties: { productosInexistentes: { type: 'array', items: { type: 'string' } } } },
        ],
      },
      ErrorConflictoCompra: {
        allOf: [
          ref('Error'),
          {
            type: 'object',
            properties: {
              productosInactivos: { type: 'array', items: { type: 'string' } },
              faltantes: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    productoId: { type: 'string' },
                    solicitado: { type: 'integer', example: 99 },
                    disponible: { type: 'integer', example: 8 },
                  },
                },
              },
            },
          },
        ],
      },
      ErrorDependencia: {
        allOf: [
          ref('Error'),
          {
            type: 'object',
            properties: {
              dependencia: { type: 'string', example: 'inventario-service', description: 'Servicio que no respondió' },
              statusRemoto: { type: 'integer', description: 'Solo en 502: código que respondió la dependencia' },
              compraId: { type: 'string', description: 'Solo si hubo que compensar un descuento' },
              compensacion: {
                type: 'string',
                enum: ['reintegrado', 'pendiente'],
                description: 'pendiente = compra FALLIDA con reintegro pendiente (D7)',
              },
            },
          },
        ],
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
