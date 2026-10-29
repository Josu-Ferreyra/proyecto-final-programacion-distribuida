const config = require('./env');

// Especificación OpenAPI escrita como objeto, igual que en Catálogo. Los ejemplos usan valores
// ficticios: ningún token ni password real.
const json = (schema, example) => ({ 'application/json': example === undefined ? { schema } : { schema, example } });
const ref = (nombre) => ({ $ref: `#/components/schemas/${nombre}` });
const respuesta = (nombre) => ({ $ref: `#/components/responses/${nombre}` });
const error = (mensaje) => ({ error: mensaje, servicio: config.serviceName });

// Marca un endpoint como protegido: esquema Bearer, roles en la descripción y respuestas 401 y 403.
function proteger(operacion, roles) {
  operacion.security = [{ bearerAuth: [] }];
  const nota = roles
    ? '**Requiere** `Authorization: Bearer <token>` con rol ' + roles.map((r) => '`' + r + '`').join(' o ') + '.'
    : '**Requiere** `Authorization: Bearer <token>` (cualquier rol).';
  operacion.description = operacion.description ? nota + '\n\n' + operacion.description : nota;
  operacion.responses[401] = respuesta('NoAutenticado');
  if (roles) operacion.responses[403] = respuesta('SinPermiso');
}

const credenciales = {
  required: true,
  content: json(ref('Credenciales'), { email: 'ana@ejemplo.com', password: 'una-password-larga' }),
};

const spec = {
  openapi: '3.0.3',
  info: {
    title: 'auth-service - TP7 Programación Distribuida',
    version: '1.0.0',
    description:
      'Única autoridad sobre credenciales: registra usuarios, guarda la password como hash bcrypt, ' +
      'la verifica y emite el access token JWT (HS256, 15 minutos) que validan los demás servicios ' +
      'localmente, sin consultar a auth-service.\n\n' +
      '**Cómo probar:** `POST /auth/login` → copiar `accessToken` → botón **Authorize** → pegar el ' +
      'token (sin la palabra Bearer). El token sirve también en Catálogo, Inventario y Ventas.\n\n' +
      'Roles: `CLIENTE` (compra), `ADMIN` (administra catálogo, stock y usuarios) y `SERVICIO` ' +
      '(cuenta técnica de Ventas). El primer `ADMIN` y la cuenta de Ventas se crean al arrancar.',
  },
  // Relativo: Swagger UI llama al mismo host y puerto desde el que se abrió.
  servers: [{ url: '/', description: config.serviceName }],
  tags: [
    { name: 'Autenticación', description: 'Registro, login e identidad propia' },
    { name: 'Usuarios', description: 'Administración de cuentas (solo ADMIN)' },
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
    '/auth/register': {
      post: {
        tags: ['Autenticación'],
        summary: 'Registrarse como cliente (público)',
        description: 'Siempre crea un usuario `CLIENTE`. Si el body trae `rol`, se ignora: un `ADMIN` solo lo puede crear otro `ADMIN` con `POST /auth/usuarios`.',
        requestBody: credenciales,
        responses: {
          201: { description: 'Usuario creado (sin password ni hash)', content: json(ref('Usuario')) },
          400: respuesta('SolicitudInvalida'),
          409: { description: 'El email ya está registrado', content: json(ref('Error'), error('El email ya está registrado')) },
          503: respuesta('SinBase'),
        },
      },
    },
    '/auth/login': {
      post: {
        tags: ['Autenticación'],
        summary: 'Obtener un access token (público)',
        description: 'Usuario inexistente y password incorrecta responden lo mismo (`401 Credenciales inválidas`), para no revelar qué emails están registrados.',
        requestBody: credenciales,
        responses: {
          200: { description: 'Credenciales válidas', content: json(ref('Token')) },
          400: respuesta('SolicitudInvalida'),
          401: { description: 'Email o password incorrectos', content: json(ref('Error'), error('Credenciales inválidas')) },
          403: { description: 'Password correcta pero la cuenta está deshabilitada', content: json(ref('Error'), error('Cuenta deshabilitada')) },
          503: respuesta('SinBase'),
        },
      },
    },
    '/auth/me': {
      get: {
        tags: ['Autenticación'],
        summary: 'Ver la propia identidad',
        responses: {
          200: { description: 'Usuario del token', content: json(ref('Identidad')) },
          404: { description: 'El token es válido pero su usuario no existe', content: json(ref('Error'), error('El usuario del token no existe')) },
          503: respuesta('SinBase'),
        },
      },
    },
    '/auth/usuarios': {
      post: {
        tags: ['Usuarios'],
        summary: 'Crear un ADMIN o un CLIENTE',
        description: 'Las cuentas `SERVICIO` no se crean por acá.',
        requestBody: {
          required: true,
          content: json(ref('UsuarioInput'), { email: 'otro-admin@ejemplo.com', password: 'una-password-larga', rol: 'ADMIN' }),
        },
        responses: {
          201: { description: 'Usuario creado', content: json(ref('Usuario')) },
          400: respuesta('SolicitudInvalida'),
          409: { description: 'El email ya está registrado', content: json(ref('Error'), error('El email ya está registrado')) },
          503: respuesta('SinBase'),
        },
      },
    },
    '/auth/usuarios/{id}': {
      patch: {
        tags: ['Usuarios'],
        summary: 'Habilitar o deshabilitar una cuenta',
        description: 'Una cuenta deshabilitada no puede hacer login (403). Los tokens que ya tenía siguen valiendo hasta su vencimiento. Un administrador no puede deshabilitarse a sí mismo.',
        parameters: [{ in: 'path', name: 'id', required: true, schema: { type: 'string' }, example: '65f1a2b3c4d5e6f7a8b9c0d1' }],
        requestBody: { required: true, content: json(ref('ActivoInput'), { activo: false }) },
        responses: {
          200: { description: 'Cuenta actualizada', content: json(ref('Usuario')) },
          400: respuesta('SolicitudInvalida'),
          404: { description: 'El usuario no existe', content: json(ref('Error')) },
          503: respuesta('SinBase'),
        },
      },
    },
  },
  components: {
    securitySchemes: {
      bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT', description: 'Access token de POST /auth/login' },
    },
    schemas: {
      Credenciales: {
        type: 'object',
        required: ['email', 'password'],
        properties: {
          email: { type: 'string', format: 'email' },
          password: { type: 'string', format: 'password', minLength: 8, maxLength: 72 },
        },
      },
      UsuarioInput: {
        type: 'object',
        required: ['email', 'password', 'rol'],
        properties: {
          email: { type: 'string', format: 'email' },
          password: { type: 'string', format: 'password', minLength: 8, maxLength: 72 },
          rol: { type: 'string', enum: ['ADMIN', 'CLIENTE'] },
        },
      },
      ActivoInput: {
        type: 'object',
        required: ['activo'],
        properties: { activo: { type: 'boolean' } },
      },
      Usuario: {
        type: 'object',
        properties: {
          id: { type: 'string', example: '65f1a2b3c4d5e6f7a8b9c0d1' },
          email: { type: 'string', example: 'ana@ejemplo.com' },
          rol: { type: 'string', enum: ['CLIENTE', 'ADMIN', 'SERVICIO'], example: 'CLIENTE' },
          activo: { type: 'boolean', example: true },
          createdAt: { type: 'string', format: 'date-time' },
        },
      },
      Identidad: {
        type: 'object',
        properties: {
          id: { type: 'string', example: '65f1a2b3c4d5e6f7a8b9c0d1' },
          email: { type: 'string', example: 'ana@ejemplo.com' },
          rol: { type: 'string', enum: ['CLIENTE', 'ADMIN', 'SERVICIO'], example: 'CLIENTE' },
          activo: { type: 'boolean', example: true },
        },
      },
      Token: {
        type: 'object',
        properties: {
          accessToken: { type: 'string', description: 'JWT firmado con HS256. Claims: sub, role, iss, iat, exp', example: 'eyJhbGciOiJIUzI1NiIs…' },
          tokenType: { type: 'string', example: 'Bearer' },
          expiresIn: { type: 'integer', description: 'Segundos de validez', example: 900 },
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
          error: { type: 'string' },
          servicio: { type: 'string', example: config.serviceName },
        },
      },
    },
    responses: {
      SolicitudInvalida: { description: 'Datos inválidos: email con mal formato, password fuera de 8–72 caracteres, rol no permitido', content: json(ref('Error'), error('El email es obligatorio y debe tener un formato válido')) },
      NoAutenticado: { description: 'Sin identidad válida: token ausente, mal formado, mal firmado o vencido', content: json(ref('Error'), error('Token vencido')) },
      SinPermiso: { description: 'Identidad válida, pero el rol no alcanza para esta operación', content: json(ref('Error'), error('Permisos insuficientes')) },
      SinBase: { description: 'La base de datos del servicio no está disponible', content: json(ref('Error'), error('Base de datos no disponible')) },
    },
  },
};

proteger(spec.paths['/auth/me'].get);
proteger(spec.paths['/auth/usuarios'].post, ['ADMIN']);
proteger(spec.paths['/auth/usuarios/{id}'].patch, ['ADMIN']);

module.exports = spec;
