// DECISIÓN DE DISEÑO (Hito 5): una escritura que llega a un follower se RECHAZA
// informando quién es el Leader. No se aplica localmente, no se redirige ni se hace
// proxy. Motivos:
//   - Es explícito: el cliente sabe que tiene que reenviar al Leader, y la respuesta
//     trae la URL para hacerlo.
//   - Es seguro: el follower no toca su base ni su log.
//   - No duplica escrituras: un proxy/redirect automático podría reenviar un POST que
//     el Leader ya había recibido si hay un timeout en el medio.
//
// Código HTTP: 421 Misdirected Request ("el pedido fue dirigido a un servidor que no
// puede producir la respuesta"). Si no se conoce ningún Leader (elección en curso o
// sin quorum) se responde 503 Service Unavailable.

const logger = require('../lib/logger');
const { getRaft } = require('../raft/instancia');

function responderNoLeader(res, raft, req) {
  const estado = raft.estado();
  const leader = estado.leaderConocido;

  if (!leader) {
    logger.warn('Escritura rechazada: no hay Leader conocido', { method: req.method, url: req.originalUrl, rol: estado.rol, term: estado.termino });
    return res.status(503).json({
      error: 'No hay un Leader conocido en este momento (elección en curso o sin quorum). Reintentá en unos segundos.',
      nodo: estado.nodo,
      rol: estado.rol,
      termino: estado.termino,
    });
  }

  logger.warn('Escritura rechazada: este nodo es follower', { method: req.method, url: req.originalUrl, leader: leader.id, term: estado.termino });
  res.set('X-Raft-Leader', leader.id);
  return res.status(421).json({
    error: `Este nodo (${estado.nodo}) es ${estado.rol}: las escrituras solo las acepta el Leader. Reenviá el pedido a ${leader.id}.`,
    nodo: estado.nodo,
    rol: estado.rol,
    termino: estado.termino,
    leader: {
      id: leader.id,
      apiUrl: leader.apiUrl,
      apiHttpsUrl: leader.apiHttpsUrl,
      reintentarEn: `${leader.apiUrl}${req.originalUrl}`,
    },
  });
}

function soloLeader(req, res, next) {
  const raft = getRaft();
  if (raft.esLeader()) return next();
  return responderNoLeader(res, raft, req);
}

// Errores que puede devolver RaftNode.proponer().
function responderErrorRaft(res, err) {
  switch (err.codigo) {
    case 'NO_SOY_LEADER':
      return responderNoLeader(res, getRaft(), res.req);
    case 'SIN_QUORUM':
      logger.warn('Escritura no confirmada: sin quorum', { index: err.index, term: err.term });
      return res.status(503).json({
        error: err.message,
        estadoEntrada: 'NO_COMMITTED',
        index: err.index,
        termino: err.term,
        nota:
          'La operación NO se aplicó. La entrada queda en el log del Leader sin confirmar: si el cluster ' +
          'recupera la mayoría con este mismo Leader podría llegar a confirmarse más adelante, y si asume ' +
          'otro Leader puede ser descartada.',
      });
    case 'LIDERAZGO_PERDIDO':
      logger.warn('Escritura no confirmada: se perdió el liderazgo', { error: err.message });
      return res.status(503).json({ error: err.message, estadoEntrada: 'INCIERTO' });
    default:
      throw err;
  }
}

module.exports = { soloLeader, responderErrorRaft };
