const express = require('express');
const { getRaft } = require('../raft/instancia');

// Endpoints de diagnóstico, de solo lectura. Permiten observar el cluster sin tocar
// los RPC internos del protocolo.
const router = express.Router();

/**
 * @openapi
 * /api/cluster/estado:
 *   get:
 *     summary: Estado Raft de este nodo (identidad, rol, término, Leader conocido, commit)
 *     tags: [Cluster (diagnóstico)]
 *     responses:
 *       200:
 *         description: Estado observable del nodo
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/EstadoNodo' }
 */
router.get('/estado', (req, res) => {
  res.json(getRaft().estado());
});

/**
 * @openapi
 * /api/cluster/log:
 *   get:
 *     summary: Log Raft de este nodo, indicando si cada entrada es LOCAL, REPLICADA, COMMITTED o APLICADA
 *     tags: [Cluster (diagnóstico)]
 *     parameters:
 *       - in: query
 *         name: desde
 *         schema: { type: integer, minimum: 1 }
 *         description: Primer índice a mostrar (por defecto 1)
 *       - in: query
 *         name: hasta
 *         schema: { type: integer, minimum: 1 }
 *         description: Último índice a mostrar (por defecto el último del log)
 *     responses:
 *       200:
 *         description: Entradas del log
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 nodo: { type: string }
 *                 rol: { type: string }
 *                 commitIndex: { type: integer }
 *                 lastApplied: { type: integer }
 *                 entradas:
 *                   type: array
 *                   items: { $ref: '#/components/schemas/EntradaLog' }
 *       400: { $ref: '#/components/responses/BadRequest' }
 */
router.get('/log', (req, res) => {
  const raft = getRaft();
  const opciones = {};

  for (const campo of ['desde', 'hasta']) {
    if (req.query[campo] !== undefined) {
      const valor = Number(req.query[campo]);
      if (!Number.isInteger(valor) || valor < 1) {
        return res.status(400).json({ error: `El parámetro "${campo}" debe ser un entero mayor o igual a 1` });
      }
      opciones[campo] = valor;
    }
  }

  const estado = raft.estado();
  res.json({
    nodo: estado.nodo,
    rol: estado.rol,
    termino: estado.termino,
    commitIndex: estado.log.commitIndex,
    lastApplied: estado.log.lastApplied,
    entradas: raft.entradasLog(opciones),
  });
});

module.exports = router;
