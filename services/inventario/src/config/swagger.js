// Especificación OpenAPI de la API pública de Inventario. C2 y C3 son el contrato con
// Ventas (docs/06-comunicaciones.md §6.2): se documentan con ejemplos de cada respuesta.
// TP7: los endpoints protegidos se marcan con proteger() al final, con los mismos roles que
// stock.routes.js y cluster.routes.js (matriz de docs/14-modelo-seguridad.md).

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

function crearSpec({ serviceName }) {
  const spec = {
    openapi: '3.0.3',
    info: {
      title: 'Servicio de Inventario - TP7 Programación Distribuida',
      version: '1.0.0',
      description:
        'Única autoridad sobre cuántas unidades de cada producto están disponibles. Corre como un ' +
        'cluster Raft de 3 nodos, pero eso no forma parte del contrato:\n\n' +
        '- **Lecturas** (`GET`): las responde el nodo que atiende, con su base local (puede estar un ' +
        'instante atrasada respecto del Leader).\n' +
        '- **Escrituras** (`PUT`, `POST`, `DELETE`): si llegan a un follower, el nodo las reenvía al Leader ' +
        'y devuelve su respuesta. Solo se responde `503` si no hay Leader o no se alcanza mayoría.\n' +
        '- Un producto sin stock registrado tiene **0** unidades disponibles.\n\n' +
        'El diagnóstico del cluster (`/api/cluster/*`) no es parte del contrato de negocio.\n\n' +
        '**Seguridad (TP7):** las consultas de stock y el estado del cluster son públicos. El resto pide un ' +
        'access token JWT de `auth-service` (botón *Authorize*): `ADMIN` para ajustar stock y ver movimientos; ' +
        '`SERVICIO` (la cuenta técnica de Ventas) o `ADMIN` para C2 y C3. Un `CLIENTE` no puede mover stock. ' +
        'Sin token, con token vencido o mal firmado: `401`. Con un rol que no alcanza: `403`.',
    },
    servers: [{ url: '/', description: serviceName }],
    tags: [
      { name: 'Stock', description: 'Disponibilidad por producto' },
      { name: 'Descuentos', description: 'Contratos C2 y C3 con Ventas' },
      { name: 'Movimientos', description: 'Historial de cambios de stock' },
      { name: 'Cluster (diagnóstico)', description: 'Estado Raft del nodo, solo lectura' },
      { name: 'Salud', description: 'Estado del proceso' },
    ],
    paths: {
      '/health': {
        get: {
          tags: ['Salud'],
          summary: 'Indica que el proceso está vivo (no consulta la base)',
          responses: {
            200: { description: 'Proceso vivo', content: json(ref('Health'), { service: 'inventario-service', nodo: 'inventario-2', status: 'ok' }) },
          },
        },
      },
      '/stock': {
        get: {
          tags: ['Stock'],
          summary: 'Disponibilidad de uno o varios productos (lectura local del nodo)',
          parameters: [
            {
              in: 'query',
              name: 'productoIds',
              schema: { type: 'string' },
              example: '65f1a2b3c4d5e6f7a8b9c0d1,65f1a2b3c4d5e6f7a8b9c0d2',
              description: 'Ids separados por coma. Sin el parámetro devuelve todo el stock registrado.',
            },
          ],
          responses: {
            200: {
              description: 'Un elemento por id pedido (0 si no tiene stock registrado)',
              content: json({ type: 'array', items: ref('Stock') }, [
                { productoId: '65f1a2b3c4d5e6f7a8b9c0d1', stock: 10 },
                { productoId: '65f1a2b3c4d5e6f7a8b9c0d2', stock: 0 },
              ]),
            },
            400: respuesta('SolicitudInvalida'),
            503: respuesta('NoDisponible'),
          },
        },
      },
      '/stock/{productoId}': {
        put: {
          tags: ['Stock'],
          summary: 'Alta o ajuste del stock de un producto',
          description:
            'Si el producto todavía no tiene stock, primero se verifica con Catálogo que exista y esté ' +
            'activo (contrato C4) y se registra un movimiento `ALTA`. Si ya tiene, se registra un `AJUSTE`. ' +
            'Pasa por el mismo lock que los descuentos.',
          parameters: [{ in: 'path', name: 'productoId', required: true, schema: { type: 'string' }, example: '65f1a2b3c4d5e6f7a8b9c0d1' }],
          requestBody: {
            required: true,
            content: json({ type: 'object', required: ['cantidad'], properties: { cantidad: { type: 'integer', minimum: 0 } } }, { cantidad: 10 }),
          },
          responses: {
            200: { description: 'Stock registrado', content: json(ref('Stock'), { productoId: '65f1a2b3c4d5e6f7a8b9c0d1', stock: 10 }) },
            400: respuesta('SolicitudInvalida'),
            404: { description: 'El producto no existe en Catálogo', content: json(ref('Error'), { error: 'El producto 65f1a2b3c4d5e6f7a8b9c0d1 no existe en Catálogo', servicio: 'inventario-service' }) },
            409: { description: 'Producto dado de baja en Catálogo, o el producto está ocupado por otra operación', content: json(ref('Error')) },
            503: respuesta('NoDisponible'),
          },
        },
      },
      '/descuentos': {
        post: {
          tags: ['Descuentos'],
          summary: 'C2 · Descontar las unidades de una compra (todo o nada, idempotente por referencia)',
          description:
            'Lo usa Ventas al registrar una compra. `referencia` es el `compraId` que genera Ventas: repetir ' +
            'la misma referencia no descuenta dos veces (responde `200`). Si a algún ítem no le alcanza el ' +
            'stock, no se descuenta ninguno (`409` con los faltantes).',
          requestBody: {
            required: true,
            content: json(ref('DescuentoInput'), {
              referencia: '3f2c9a1e-8b7d-4c1a-9f3e-2a6b5c4d3e21',
              items: [
                { productoId: '65f1a2b3c4d5e6f7a8b9c0d1', cantidad: 2 },
                { productoId: '65f1a2b3c4d5e6f7a8b9c0d2', cantidad: 1 },
              ],
            }),
          },
          responses: {
            201: { description: 'Descontado ahora', content: json(ref('Descuento')) },
            200: { description: 'Esa referencia ya se había descontado: no se descuenta de nuevo', content: json(ref('Descuento')) },
            400: respuesta('SolicitudInvalida'),
            409: {
              description: 'Stock insuficiente (no se descontó nada), o los productos están ocupados por otra operación',
              content: json(ref('StockInsuficiente'), {
                error: 'Stock insuficiente',
                servicio: 'inventario-service',
                faltantes: [{ productoId: '65f1a2b3c4d5e6f7a8b9c0d2', solicitado: 1, disponible: 0 }],
              }),
            },
            503: respuesta('NoDisponible'),
          },
        },
      },
      '/descuentos/{referencia}': {
        delete: {
          tags: ['Descuentos'],
          summary: 'C3 · Reintegrar exactamente lo descontado con esa referencia',
          description: 'Lo usa Ventas al cancelar una compra o para compensar una que falló después de descontar. Es idempotente.',
          parameters: [{ in: 'path', name: 'referencia', required: true, schema: { type: 'string' }, example: '3f2c9a1e-8b7d-4c1a-9f3e-2a6b5c4d3e21' }],
          responses: {
            204: { description: 'Reintegrado (también si ya estaba reintegrado)' },
            400: respuesta('SolicitudInvalida'),
            404: { description: 'Nunca hubo un descuento con esa referencia', content: json(ref('Error'), { error: 'No hay un descuento con la referencia 3f2c9a1e-8b7d-4c1a-9f3e-2a6b5c4d3e21', servicio: 'inventario-service' }) },
            503: respuesta('NoDisponible'),
          },
        },
      },
      '/movimientos': {
        get: {
          tags: ['Movimientos'],
          summary: 'Historial de cambios de stock (lectura local del nodo)',
          parameters: [{ in: 'query', name: 'productoId', schema: { type: 'string' }, description: 'Filtra por producto' }],
          responses: {
            200: { description: 'Movimientos en orden de aplicación', content: json({ type: 'array', items: ref('Movimiento') }) },
            400: respuesta('SolicitudInvalida'),
            503: respuesta('NoDisponible'),
          },
        },
      },
      '/api/cluster/estado': {
        get: { tags: ['Cluster (diagnóstico)'], summary: 'Rol, término, Leader conocido, commit y replicación de este nodo', responses: { 200: { description: 'Estado Raft' } } },
      },
      '/api/cluster/log': {
        get: {
          tags: ['Cluster (diagnóstico)'],
          summary: 'Log Raft del nodo con el estado de cada entrada (LOCAL, REPLICADA, RECIBIDA, COMMITTED, APLICADA)',
          parameters: [
            { in: 'query', name: 'desde', schema: { type: 'integer', minimum: 1 } },
            { in: 'query', name: 'hasta', schema: { type: 'integer', minimum: 1 } },
          ],
          responses: { 200: { description: 'Entradas del log' }, 400: respuesta('SolicitudInvalida') },
        },
      },
    },
    components: {
      schemas: {
        Health: { type: 'object', properties: { service: { type: 'string' }, nodo: { type: 'string' }, status: { type: 'string' } } },
        Stock: { type: 'object', properties: { productoId: { type: 'string' }, stock: { type: 'integer', minimum: 0 } } },
        Item: {
          type: 'object',
          required: ['productoId', 'cantidad'],
          properties: { productoId: { type: 'string' }, cantidad: { type: 'integer', minimum: 1 } },
        },
        DescuentoInput: {
          type: 'object',
          required: ['referencia', 'items'],
          properties: {
            referencia: { type: 'string', description: 'compraId de Ventas' },
            items: { type: 'array', minItems: 1, maxItems: 50, items: ref('Item') },
            usuarioId: { type: 'string', description: 'Para quién fue la compra (el sub del cliente). Opcional: si falta, se usa el del token' },
          },
        },
        Descuento: { type: 'object', properties: { referencia: { type: 'string' }, items: { type: 'array', items: ref('Item') } } },
        Movimiento: {
          type: 'object',
          properties: {
            productoId: { type: 'string' },
            tipo: { type: 'string', enum: ['ALTA', 'AJUSTE', 'DESCUENTO', 'REINTEGRO'] },
            cantidad: { type: 'integer', description: 'Con signo' },
            stockResultante: { type: 'integer' },
            referencia: { type: 'string' },
            usuarioId: { type: 'string', description: 'Quién originó el movimiento' },
            fecha: { type: 'string', format: 'date-time' },
            indiceRaft: { type: 'integer' },
          },
        },
        Error: { type: 'object', properties: { error: { type: 'string' }, servicio: { type: 'string' } } },
        StockInsuficiente: {
          allOf: [
            ref('Error'),
            {
              type: 'object',
              properties: {
                faltantes: {
                  type: 'array',
                  items: { type: 'object', properties: { productoId: { type: 'string' }, solicitado: { type: 'integer' }, disponible: { type: 'integer' } } },
                },
              },
            },
          ],
        },
      },
      securitySchemes: {
        bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT', description: 'Access token de auth-service (POST /auth/login)' },
      },
      responses: {
        NoAutenticado: {
          description: 'Sin identidad válida: token ausente, mal formado, mal firmado o vencido',
          content: json(ref('Error'), { error: 'Token vencido', servicio: 'inventario-service' }),
        },
        SinPermiso: {
          description: 'Identidad válida, pero el rol no alcanza para esta operación',
          content: json(ref('Error'), { error: 'Permisos insuficientes', servicio: 'inventario-service' }),
        },
        SolicitudInvalida: { description: 'Datos inválidos', content: json(ref('Error'), { error: 'La "cantidad" debe ser un entero mayor o igual a 0', servicio: 'inventario-service' }) },
        NoDisponible: {
          description: 'Inventario no pudo completar la operación: sin Leader, sin mayoría, base, Redis o Catálogo no disponibles',
          content: json(ref('Error'), { error: 'Inventario sin Leader disponible', servicio: 'inventario-service' }),
        },
      },
    },
  };

  proteger(spec.paths['/stock/{productoId}'].put, ['ADMIN']);
  proteger(spec.paths['/descuentos'].post, ['SERVICIO', 'ADMIN']);
  proteger(spec.paths['/descuentos/{referencia}'].delete, ['SERVICIO', 'ADMIN']);
  proteger(spec.paths['/movimientos'].get, ['ADMIN']);
  proteger(spec.paths['/api/cluster/log'].get, ['ADMIN']);
  return spec;
}

module.exports = { crearSpec };
