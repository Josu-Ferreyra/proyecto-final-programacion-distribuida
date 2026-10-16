// Servidor HTTP interno del protocolo (puerto raftPort de cada nodo).
//
// Está separado de la API de negocio a propósito: estos endpoints los usan los nodos
// entre sí. Llamarlos a mano puede cambiar el término o el log de un nodo, así que
// NO son un mecanismo de prueba de negocio (para eso está /api/productos).

const path = require('path');
const express = require('express');
const swaggerUi = require('swagger-ui-express');
const swaggerJsdoc = require('swagger-jsdoc');
const logger = require('../lib/logger');
const { getRaft } = require('./instancia');

function esEnteroNoNegativo(v) {
  return Number.isInteger(v) && v >= 0;
}

function crearRaftApp(nodo) {
  const app = express();
  app.use(express.json({ limit: '5mb' }));

  const spec = swaggerJsdoc({
    definition: {
      openapi: '3.0.3',
      info: {
        title: `RPC internos Raft - ${nodo.id}`,
        version: '1.0.0',
        description:
          'Comunicación interna entre nodos del cluster (HTTP). **No usar como API de negocio ni como ' +
          'mecanismo ordinario de prueba**: RequestVote y AppendEntries modifican el término, el voto y el ' +
          'log del nodo que los recibe. La API de negocio está en el puerto de la API externa (/api-docs).',
      },
      servers: [{ url: nodo.raftUrl, description: `Puerto interno de ${nodo.id}` }],
      tags: [{ name: 'Raft (interno)', description: 'RPC entre nodos' }],
    },
    apis: [__filename.split(path.sep).join('/')], // glob necesita "/" también en Windows
  });

  app.use('/raft-docs', swaggerUi.serve, swaggerUi.setup(spec));
  app.get('/raft-docs.json', (req, res) => res.json(spec));

  /**
   * @openapi
   * /raft/request-vote:
   *   post:
   *     summary: RequestVote - un candidato pide el voto de este nodo
   *     tags: [Raft (interno)]
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             required: [term, candidateId, lastLogIndex, lastLogTerm]
   *             properties:
   *               term: { type: integer, example: 3 }
   *               candidateId: { type: string, example: nodo2 }
   *               lastLogIndex: { type: integer, example: 7 }
   *               lastLogTerm: { type: integer, example: 2 }
   *     responses:
   *       200:
   *         description: Resultado del voto
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 term: { type: integer }
   *                 voteGranted: { type: boolean }
   *                 motivo: { type: string }
   *       400: { description: Mensaje mal formado }
   */
  app.post('/raft/request-vote', async (req, res) => {
    const { term, candidateId, lastLogIndex, lastLogTerm } = req.body || {};
    if (!esEnteroNoNegativo(term) || typeof candidateId !== 'string' || !esEnteroNoNegativo(lastLogIndex) || !esEnteroNoNegativo(lastLogTerm)) {
      return res.status(400).json({ error: 'RequestVote mal formado' });
    }
    res.json(await getRaft().handleRequestVote({ term, candidateId, lastLogIndex, lastLogTerm }));
  });

  /**
   * @openapi
   * /raft/append-entries:
   *   post:
   *     summary: AppendEntries - heartbeat y replicación de entradas desde el Leader
   *     description: Con entries vacío funciona como heartbeat.
   *     tags: [Raft (interno)]
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             required: [term, leaderId, prevLogIndex, prevLogTerm, entries, leaderCommit]
   *             properties:
   *               term: { type: integer, example: 3 }
   *               leaderId: { type: string, example: nodo1 }
   *               prevLogIndex: { type: integer, example: 7 }
   *               prevLogTerm: { type: integer, example: 3 }
   *               leaderCommit: { type: integer, example: 7 }
   *               entries:
   *                 type: array
   *                 items:
   *                   type: object
   *                   properties:
   *                     index: { type: integer }
   *                     term: { type: integer }
   *                     comando: { type: object }
   *                     creadaEn: { type: string, format: date-time }
   *     responses:
   *       200:
   *         description: Resultado del chequeo de continuidad
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 term: { type: integer }
   *                 success: { type: boolean }
   *                 ultimoIndice: { type: integer, description: Pista para que el Leader ajuste nextIndex }
   *                 motivo: { type: string }
   *       400: { description: Mensaje mal formado }
   */
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
    res.json(await getRaft().handleAppendEntries({ term, leaderId, prevLogIndex, prevLogTerm, entries, leaderCommit }));
  });

  /**
   * @openapi
   * /raft/estado:
   *   get:
   *     summary: Estado del nodo (solo lectura, igual a GET /api/cluster/estado)
   *     tags: [Raft (interno)]
   *     responses:
   *       200: { description: Estado Raft del nodo }
   */
  app.get('/raft/estado', (req, res) => res.json(getRaft().estado()));

  app.use((req, res) => res.status(404).json({ error: 'Ruta interna no encontrada' }));

  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    logger.error('Error en RPC interno', { error: err.message, stack: err.stack, url: req.originalUrl });
    res.status(500).json({ error: 'Error interno procesando el RPC' });
  });

  return app;
}

module.exports = { crearRaftApp };
