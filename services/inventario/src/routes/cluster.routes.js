const express = require('express');

// Diagnóstico del nodo, de solo lectura (como en el TP4). Conserva el path /api/cluster
// (D4). No forma parte del contrato de negocio: Ventas no lo usa.
//   /estado  público: rol, término y commit, sin datos de negocio (lo usan estado-cluster.js y el failover)
//   /log     ADMIN: cada entrada trae el comando, con productos, cantidades y usuarioId
function crearClusterRouter({ raft, auth }) {
  const router = express.Router();

  router.get('/estado', (req, res) => {
    res.json(raft.estado());
  });

  router.get('/log', auth.autenticar, auth.requerirRol('ADMIN'), (req, res) => {
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

  return router;
}

module.exports = { crearClusterRouter };
