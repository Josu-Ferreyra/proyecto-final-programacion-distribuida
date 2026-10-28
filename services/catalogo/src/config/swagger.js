const { CATEGORIAS, CATEGORIA_POR_DEFECTO } = require('../models/categorias');
const config = require('./env');

// Especificación OpenAPI escrita como objeto (y no con comentarios en las rutas)
// para poder tomar las categorías del mismo módulo que usa el schema.
// TP7: los endpoints protegidos se marcan con proteger() al final, con los mismos roles que
// productos.routes.js (matriz de docs/14-modelo-seguridad.md).
const json = (schema, example) => ({ 'application/json': example === undefined ? { schema } : { schema, example } });
const ref = (nombre) => ({ $ref: `#/components/schemas/${nombre}` });
const respuesta = (nombre) => ({ $ref: `#/components/responses/${nombre}` });

// Marca un endpoint como protegido: esquema Bearer, roles en la descripción y respuestas 401 y 403.
function proteger(operacion, roles) {
  operacion.security = [{ bearerAuth: [] }];
  const rolesTexto = roles.map((r) => '`' + r + '`').join(' o ');
  const nota = '**Requiere** `Authorization: Bearer <token>` con rol ' + rolesTexto + '.';
  operacion.description = operacion.description ? nota + '\n\n' + operacion.description : nota;
  operacion.responses[401] = respuesta('NoAutenticado');
  operacion.responses[403] = respuesta('SinPermiso');
}

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
    title: 'Servicio de Catálogo - TP7 Programación Distribuida',
    version: '1.0.0',
    description:
      'Define qué productos se ofrecen, con qué nombre, en qué categoría y a qué precio.\n\n' +
      'No guarda stock: la disponibilidad se consulta en Inventario (`GET /stock?productoIds=…`).\n\n' +
      '**Seguridad (TP7):** las consultas (`GET`) son públicas. Dar de alta, modificar o dar de baja un ' +
      'producto pide un access token JWT de `auth-service` con rol `ADMIN` (`POST http://localhost:3400/auth/login`, ' +
      'y después el botón *Authorize*). Sin token, con token vencido o mal firmado: `401`. Con otro rol: `403`.',
  },
  // Relativo: Swagger UI llama al mismo host y puerto desde el que se abrió.
  servers: [{ url: '/', description: config.serviceName }],
  tags: [
    { name: 'Productos', description: 'Oferta: nombre, categoría y precio vigente' },
    { name: 'Categorías', description: 'Categorías válidas para un producto' },
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
        summary: 'Listar, buscar o consultar varios productos por id (C1)',
        description: 'Incluye los productos dados de baja, con `activo: false`.',
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
          {
            in: 'query',
            name: 'ids',
            schema: { type: 'string' },
            example: '65f1a2b3c4d5e6f7a8b9c0d1,65f1a2b3c4d5e6f7a8b9c0d2',
            description:
              'Contrato **C1** (lo usa Ventas): ids separados por coma. Devuelve los que existen, activos o no; ' +
              'los ids inexistentes o mal formados no aparecen en la respuesta.',
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
        summary: 'Consultar un producto (contrato C4, lo usa Inventario)',
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
        summary: 'Dar de baja un producto (baja lógica)',
        description:
          'No borra el documento: lo deja con `activo = false`, porque Inventario y Ventas guardan su id. ' +
          'Repetir la baja también responde 204.',
        parameters: [parametroId],
        responses: {
          204: { description: 'Producto dado de baja (o ya lo estaba)' },
          400: respuesta('BadRequest'),
          404: respuesta('NotFound'),
          503: respuesta('SinBase'),
        },
      },
    },
    '/categorias': {
      get: {
        tags: ['Categorías'],
        summary: 'Listar las categorías válidas',
        responses: {
          200: {
            description: 'Categorías que acepta el campo categoria',
            content: json({ type: 'array', items: { type: 'string' }, example: CATEGORIAS }),
          },
        },
      },
    },
  },
  components: {
    securitySchemes: {
      bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT', description: 'Access token de auth-service (POST /auth/login)' },
    },
    schemas: {
      Producto: {
        type: 'object',
        properties: {
          id: { type: 'string', example: '65f1a2b3c4d5e6f7a8b9c0d1' },
          nombre: { type: 'string', example: 'Teclado mecánico' },
          precio: { type: 'number', example: 45000 },
          categoria: { type: 'string', enum: CATEGORIAS, example: 'periferico' },
          activo: { type: 'boolean', example: true, description: 'false si el producto fue dado de baja' },
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
      NoAutenticado: {
        description: 'Sin identidad válida: token ausente, mal formado, mal firmado o vencido',
        content: json(ref('Error'), { error: 'Token ausente', servicio: config.serviceName }),
      },
      SinPermiso: {
        description: 'Identidad válida, pero el rol no alcanza para esta operación',
        content: json(ref('Error'), { error: 'Permisos insuficientes', servicio: config.serviceName }),
      },
      BadRequest: { description: 'Datos, parámetros o id con formato inválido, o campos que no son de Catálogo (como stock)', content: json(ref('Error')) },
      NotFound: { description: 'El producto no existe', content: json(ref('Error')) },
      Conflict: { description: 'Ya existe un producto con ese nombre', content: json(ref('Error')) },
      SinBase: { description: 'La base de datos del servicio no está disponible', content: json(ref('Error')) },
    },
  },
};

proteger(spec.paths['/productos'].post, ['ADMIN']);
proteger(spec.paths['/productos/{id}'].put, ['ADMIN']);
proteger(spec.paths['/productos/{id}'].delete, ['ADMIN']);

module.exports = spec;
