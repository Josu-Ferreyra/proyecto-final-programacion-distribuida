const path = require('path');
const swaggerJsdoc = require('swagger-jsdoc');

const errorJson = { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } };

function crearSpec(nodo) {
  const options = {
    definition: {
      openapi: '3.0.3',
      info: {
        title: `API Productos - TP4 Programación Distribuida (${nodo.id})`,
        version: '2.0.0',
        description:
          'CRUD de productos replicado en un cluster de 3 nodos con una implementación educativa de **Raft**. ' +
          'Cada nodo tiene su propia base MongoDB.\n\n' +
          '- **Lecturas (GET)**: se resuelven con la base local del nodo que atiende.\n' +
          '- **Escrituras (POST/PUT/DELETE/comprar)**: solo las acepta el Leader. Se convierten en un comando, ' +
          'se agregan al log Raft, se replican y recién cuando una mayoría las tiene (commit) la State Machine ' +
          'las aplica en la base de cada nodo. Un follower responde **421** indicando quién es el Leader.\n' +
          '- **Cluster (diagnóstico)**: estado y log Raft del nodo, solo lectura.\n\n' +
          `Los RPC internos del protocolo (RequestVote, AppendEntries) **no** forman parte de esta API: están en ` +
          `el puerto interno ${nodo.raftPort} (${nodo.raftUrl}/raft-docs) y no deben usarse como prueba de negocio.`,
      },
      servers: [
        { url: `http://${nodo.host}:${nodo.apiHttpPort}`, description: `HTTP - ${nodo.id}` },
        { url: `https://${nodo.host}:${nodo.apiHttpsPort}`, description: `HTTPS - ${nodo.id} (certificado autofirmado)` },
      ],
      tags: [
        { name: 'Productos', description: 'API de negocio' },
        { name: 'Cluster (diagnóstico)', description: 'Observabilidad del nodo Raft (solo lectura)' },
      ],
      components: {
        parameters: {
          ProductoId: {
            in: 'path',
            name: 'id',
            required: true,
            schema: { type: 'string' },
            description: 'ObjectId de MongoDB del producto (el mismo en las tres réplicas)',
            example: '65f1a2b3c4d5e6f7a8b9c0d1',
          },
        },
        schemas: {
          Producto: {
            type: 'object',
            properties: {
              id: { type: 'string', example: '65f1a2b3c4d5e6f7a8b9c0d1' },
              nombre: { type: 'string', example: 'Teclado mecánico' },
              precio: { type: 'number', example: 25000 },
              stock: { type: 'integer', example: 10 },
              categoria: { type: 'string', enum: ['periferico', 'monitor', 'accesorio', 'otro'], example: 'periferico' },
              version: { type: 'integer', example: 2, description: 'Cantidad de modificaciones aplicadas' },
              ultimoIndiceRaft: { type: 'integer', example: 7, description: 'Índice del log que lo modificó por última vez' },
              createdAt: { type: 'string', format: 'date-time' },
              updatedAt: { type: 'string', format: 'date-time' },
            },
          },
          ProductoInput: {
            type: 'object',
            required: ['nombre', 'precio', 'stock'],
            properties: {
              nombre: { type: 'string', example: 'Teclado mecánico' },
              precio: { type: 'number', minimum: 0.01, example: 25000 },
              stock: { type: 'integer', minimum: 0, example: 10 },
              categoria: { type: 'string', enum: ['periferico', 'monitor', 'accesorio', 'otro'], example: 'periferico' },
            },
          },
          Error: {
            type: 'object',
            properties: { error: { type: 'string' } },
          },
          NoEsLeader: {
            type: 'object',
            properties: {
              error: { type: 'string' },
              nodo: { type: 'string', example: 'nodo2' },
              rol: { type: 'string', example: 'FOLLOWER' },
              termino: { type: 'integer', example: 3 },
              leader: {
                type: 'object',
                properties: {
                  id: { type: 'string', example: 'nodo1' },
                  apiUrl: { type: 'string', example: 'http://127.0.0.1:3001' },
                  apiHttpsUrl: { type: 'string', example: 'https://127.0.0.1:3441' },
                  reintentarEn: { type: 'string', example: 'http://127.0.0.1:3001/api/productos' },
                },
              },
            },
          },
          EstadoNodo: {
            type: 'object',
            properties: {
              nodo: { type: 'string', example: 'nodo1' },
              rol: { type: 'string', enum: ['FOLLOWER', 'CANDIDATE', 'LEADER'] },
              termino: { type: 'integer', example: 3 },
              votoEmitido: { type: 'string', nullable: true, example: 'nodo1' },
              leaderConocido: { type: 'object', nullable: true },
              cluster: { type: 'object' },
              log: {
                type: 'object',
                properties: {
                  ultimoIndice: { type: 'integer' },
                  ultimoTermino: { type: 'integer' },
                  commitIndex: { type: 'integer' },
                  lastApplied: { type: 'integer' },
                  entradasSinCommit: { type: 'integer' },
                },
              },
              heartbeats: { type: 'object' },
              electionTimeout: { type: 'object' },
              replicacion: { type: 'array', nullable: true, items: { type: 'object' }, description: 'nextIndex/matchIndex por follower (solo en el Leader)' },
              persistencia: { type: 'object' },
            },
          },
          EntradaLog: {
            type: 'object',
            properties: {
              index: { type: 'integer', example: 4 },
              term: { type: 'integer', example: 2 },
              estado: { type: 'string', enum: ['LOCAL', 'REPLICADA', 'RECIBIDA', 'COMMITTED', 'APLICADA'] },
              comando: { type: 'object', example: { tipo: 'CREAR_PRODUCTO', id: '65f1a2b3c4d5e6f7a8b9c0d1' } },
              creadaEn: { type: 'string', format: 'date-time' },
              presenteEn: { type: 'array', items: { type: 'string' }, description: 'Solo en el Leader' },
            },
          },
        },
        responses: {
          BadRequest: { description: 'Datos o identificador inválidos', content: errorJson },
          NotFound: { description: 'Identificador válido cuyo recurso no existe', content: errorJson },
          Conflict: { description: 'Conflicto de integridad (ej. nombre duplicado)', content: errorJson },
          NoEsLeader: {
            description: 'El nodo que recibió la escritura es follower: no la aplica y responde quién es el Leader',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/NoEsLeader' } } },
          },
          SinConsenso: {
            description:
              'No hay Leader conocido, o la entrada no alcanzó mayoría dentro del tiempo límite (no fue aplicada)',
            content: errorJson,
          },
        },
      },
    },
    // glob (usado por swagger-jsdoc) necesita "/" también en Windows.
    apis: [path.join(__dirname, '..', 'routes', '*.js').split(path.sep).join('/')],
  };

  return swaggerJsdoc(options);
}

module.exports = { crearSpec };
