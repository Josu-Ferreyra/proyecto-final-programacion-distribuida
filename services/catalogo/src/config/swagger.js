const { CATEGORIAS, CATEGORIA_POR_DEFECTO } = require('../models/categorias');
const config = require('./env');

// Especificación OpenAPI escrita como objeto (y no con comentarios en las rutas)
// para poder tomar las categorías del mismo módulo que usa el schema.
const json = (schema) => ({ 'application/json': { schema } });
const ref = (nombre) => ({ $ref: `#/components/schemas/${nombre}` });
const respuesta = (nombre) => ({ $ref: `#/components/responses/${nombre}` });

const parametroId = {
  in: 'path',
  name: 'id',
  required: true,
  schema: { type: 'string' },
  description: 'ObjectId de MongoDB del producto',
  example: '65f1a2b3c4d5e6f7a8b9c0d1',
};

const spec = {
  openapi: '3.0.3',
  info: {
    title: 'Servicio de Catálogo - TP6 Programación Distribuida',
    version: '1.0.0',
    description:
      'Define qué productos se ofrecen, con qué nombre, en qué categoría y a qué precio.\n\n' +
      'No guarda stock: la disponibilidad se consulta en Inventario (`GET /stock?productoIds=…`).',
  },
  // Relativo: Swagger UI llama al mismo host y puerto desde el que se abrió.
  servers: [{ url: '/', description: config.serviceName }],
  tags: [
    { name: 'Productos', description: 'Oferta: nombre, categoría y precio vigente' },
    { name: 'Salud', description: 'Estado del proceso' },
  ],
  paths: {
    '/health': {
      get: {
        tags: ['Salud'],
        summary: 'Indica que el proceso está vivo (no consulta la base)',
        responses: { 200: { description: 'Proceso vivo', content: json(ref('Health')) } },
      },
    },
    '/productos': {
      get: {
        tags: ['Productos'],
        summary: 'Listar y buscar productos',
        parameters: [
          {
            in: 'query',
            name: 'nombreContiene',
            schema: { type: 'string' },
            description: 'Productos cuyo nombre contiene este texto (sin distinguir mayúsculas)',
          },
          {
            in: 'query',
            name: 'categoria',
            schema: { type: 'string', enum: CATEGORIAS },
            description: 'Categoría exacta',
          },
        ],
        responses: {
          200: { description: 'Productos que cumplen los filtros', content: json({ type: 'array', items: ref('Producto') }) },
          400: respuesta('BadRequest'),
          503: respuesta('SinBase'),
        },
      },
      post: {
        tags: ['Productos'],
        summary: 'Dar de alta un producto (sin stock)',
        description: 'El stock inicial se carga después en Inventario con `PUT /stock/:productoId`. Si el body trae `stock` u otro campo que no sea de Catálogo, responde 400.',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: ref('ProductoInput'),
              example: { nombre: 'Teclado mecánico', precio: 45000, categoria: 'periferico' },
            },
          },
        },
        responses: {
          201: { description: 'Producto creado', content: json(ref('Producto')) },
          400: respuesta('BadRequest'),
          409: respuesta('Conflict'),
          503: respuesta('SinBase'),
        },
      },
    },
    '/productos/{id}': {
      get: {
        tags: ['Productos'],
        summary: 'Consultar un producto',
        parameters: [parametroId],
        responses: {
          200: { description: 'Producto encontrado', content: json(ref('Producto')) },
          400: respuesta('BadRequest'),
          404: respuesta('NotFound'),
          503: respuesta('SinBase'),
        },
      },
      put: {
        tags: ['Productos'],
        summary: 'Modificar nombre, precio o categoría (parcial)',
        description: 'Solo acepta `nombre`, `precio` y `categoria`. Con `stock` responde 400: el stock se ajusta con `PUT /stock/:productoId` en Inventario.',
        parameters: [parametroId],
        requestBody: {
          required: true,
          content: { 'application/json': { schema: ref('ProductoInput'), example: { precio: 47000 } } },
        },
        responses: {
          200: { description: 'Producto modificado', content: json(ref('Producto')) },
          400: respuesta('BadRequest'),
          404: respuesta('NotFound'),
          409: respuesta('Conflict'),
          503: respuesta('SinBase'),
        },
      },
      delete: {
        tags: ['Productos'],
        summary: 'Eliminar un producto',
        parameters: [parametroId],
        responses: {
          204: { description: 'Producto eliminado' },
          400: respuesta('BadRequest'),
          404: respuesta('NotFound'),
          503: respuesta('SinBase'),
        },
      },
    },
  },
  components: {
    schemas: {
      Producto: {
        type: 'object',
        properties: {
          id: { type: 'string', example: '65f1a2b3c4d5e6f7a8b9c0d1' },
          nombre: { type: 'string', example: 'Teclado mecánico' },
          precio: { type: 'number', example: 45000 },
          categoria: { type: 'string', enum: CATEGORIAS, example: 'periferico' },
          createdAt: { type: 'string', format: 'date-time' },
          updatedAt: { type: 'string', format: 'date-time' },
        },
      },
      ProductoInput: {
        type: 'object',
        required: ['nombre', 'precio'],
        properties: {
          nombre: { type: 'string', description: 'Único; se guardan sin espacios sobrantes', example: 'Teclado mecánico' },
          precio: { type: 'number', exclusiveMinimum: true, minimum: 0, example: 45000 },
          categoria: { type: 'string', enum: CATEGORIAS, default: CATEGORIA_POR_DEFECTO, example: 'periferico' },
        },
      },
      Health: {
        type: 'object',
        properties: {
          service: { type: 'string', example: config.serviceName },
          status: { type: 'string', example: 'ok' },
        },
      },
      Error: {
        type: 'object',
        properties: {
          error: { type: 'string', example: 'Producto con id 65f1a2b3c4d5e6f7a8b9c0d1 no encontrado' },
          servicio: { type: 'string', example: config.serviceName },
        },
      },
    },
    responses: {
      BadRequest: { description: 'Datos, parámetros o id con formato inválido, o campos que no son de Catálogo (como stock)', content: json(ref('Error')) },
      NotFound: { description: 'El producto no existe', content: json(ref('Error')) },
      Conflict: { description: 'Ya existe un producto con ese nombre', content: json(ref('Error')) },
      SinBase: { description: 'La base de datos del servicio no está disponible', content: json(ref('Error')) },
    },
  },
};

module.exports = spec;
