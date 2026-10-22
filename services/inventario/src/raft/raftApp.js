// Servidor HTTP interno del protocolo (puerto raftPort de cada nodo).
//
// Está separado de la API de negocio a propósito: estos endpoints los usan los nodos
// entre sí. Llamarlos a mano puede cambiar el término o el log de un nodo, así que no
// son un mecanismo de prueba. Recibe el nodo Raft por parámetro (sin singleton global).

const express = require('express');
const swaggerUi = require('swagger-ui-express');

function esEnteroNoNegativo(v) {
  return Number.isInteger(v) && v >= 0;
}

const json = (schema) => ({ 'application/json': { schema } });

function crearSpec(nodo) {
  return {
    openapi: '3.0.3',
    info: {
      title: `RPC internos Raft - ${nodo.id}`,
      version: '1.0.0',
      description:
        'Comunicación interna entre los nodos del cluster de Inventario. **No es parte de la API ' +
        'del servicio**: RequestVote y AppendEntries modifican el término, el voto y el log del nodo ' +
        'que los recibe. La API pública está en `/api-docs` del puerto de la API.',
    },
    servers: [{ url: '/', description: `Puerto interno de ${nodo.id}` }],
    paths: {
      '/raft/request-vote': {
        post: {
          summary: 'RequestVote: un candidato pide el voto de este nodo',
          requestBody: {
            required: true,
            content: json({
              type: 'object',
              required: ['term', 'candidateId', 'lastLogIndex', 'lastLogTerm'],
              properties: {
                term: { type: 'integer', example: 3 },
                candidateId: { type: 'string', example: 'inventario-2' },
                lastLogIndex: { type: 'integer', example: 7 },
                lastLogTerm: { type: 'integer', example: 2 },
              },
            }),
          },
          responses: {
            200: {
              description: 'Resultado del voto',
              content: json({
                type: 'object',
                properties: { term: { type: 'integer' }, voteGranted: { type: 'boolean' }, motivo: { type: 'string' } },
              }),
            },
            400: { description: 'Mensaje mal formado' },
          },
        },
      },
      '/raft/append-entries': {
        post: {
          summary: 'AppendEntries: heartbeat y replicación de entradas desde el Leader',
          description: 'Con `entries` vacío funciona como heartbeat.',
          requestBody: {
            required: true,
            content: json({
              type: 'object',
              required: ['term', 'leaderId', 'prevLogIndex', 'prevLogTerm', 'entries', 'leaderCommit'],
              properties: {
                term: { type: 'integer', example: 3 },
                leaderId: { type: 'string', example: 'inventario-1' },
                prevLogIndex: { type: 'integer', example: 7 },
                prevLogTerm: { type: 'integer', example: 3 },
                leaderCommit: { type: 'integer', example: 7 },
                entries: {
                  type: 'array',
                  items: {
                    type: 'object',
                    properties: {
                      index: { type: 'integer' },
                      term: { type: 'integer' },
                      comando: { type: 'object', description: 'Opaco para el protocolo' },
                      creadaEn: { type: 'string', format: 'date-time' },
                    },
                  },
                },
              },
            }),
          },
          responses: {
            200: {
              description: 'Resultado del chequeo de continuidad',
              content: json({
                type: 'object',
                properties: {
                  term: { type: 'integer' },
                  success: { type: 'boolean' },
                  ultimoIndice: { type: 'integer', description: 'Pista para que el Leader ajuste nextIndex' },
                  motivo: { type: 'string' },
                },
              }),
            },
            400: { description: 'Mensaje mal formado' },
          },
        },
      },
      '/raft/estado': {
        get: { summary: 'Estado del nodo (igual a GET /api/cluster/estado)', responses: { 200: { description: 'Estado Raft' } } },
      },
    },
  };
}

function crearRaftApp({ raft, nodo, logger }) {
  const app = express();
  app.use(express.json({ limit: '5mb' }));

  const spec = crearSpec(nodo);
  app.use('/raft-docs', swaggerUi.serve, swaggerUi.setup(spec));
  app.get('/raft-docs.json', (req, res) => res.json(spec));

  app.post('/raft/request-vote', async (req, res) => {
    const { term, candidateId, lastLogIndex, lastLogTerm } = req.body || {};
    if (!esEnteroNoNegativo(term) || typeof candidateId !== 'string' || !esEnteroNoNegativo(lastLogIndex) || !esEnteroNoNegativo(lastLogTerm)) {
      return res.status(400).json({ error: 'RequestVote mal formado' });
    }
    res.json(await raft.handleRequestVote({ term, candidateId, lastLogIndex, lastLogTerm }));
  });

  app.post('/raft/append-entries', async (req, res) => {
    const { term, leaderId, prevLogIndex, prevLogTerm, entries, leaderCommit } = req.body || {};
    if (
      !esEnteroNoNegativo(term) ||
      typeof leaderId !== 'string' ||
      !esEnteroNoNegativo(prevLogIndex) ||
      !esEnteroNoNegativo(prevLogTerm) ||
      !esEnteroNoNegativo(leaderCommit) ||
      !Array.isArray(entries)
    ) {
      return res.status(400).json({ error: 'AppendEntries mal formado' });
    }
    res.json(await raft.handleAppendEntries({ term, leaderId, prevLogIndex, prevLogTerm, entries, leaderCommit }));
  });

  app.get('/raft/estado', (req, res) => res.json(raft.estado()));

  app.use((req, res) => res.status(404).json({ error: 'Ruta interna no encontrada' }));

  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    logger.error('Error en RPC interno', { operacion: `${req.method} ${req.path}`, error: err.message });
    res.status(500).json({ error: 'Error interno procesando el RPC' });
  });

  return app;
}

module.exports = { crearRaftApp };
