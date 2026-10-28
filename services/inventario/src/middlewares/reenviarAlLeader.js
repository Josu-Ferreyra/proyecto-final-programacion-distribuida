// D1 (docs/08-ratificacion-tp6.md): una escritura que llega a un follower se REENVÍA al
// Leader y se devuelve su respuesta tal cual. Así Ventas habla con "inventario-service"
// (el alias DNS que comparten los 3 nodos) sin saber que hay un cluster ni recibir un
// 421: para Ventas solo existen las respuestas del contrato, o 503 si no hay Leader.
//
// El header X-Reenviado-Por evita bucles: un pedido ya reenviado no se vuelve a reenviar
// (si llega a un nodo que tampoco es Leader, por ejemplo durante una elección, se
// responde 503).

function crearReenviarAlLeader({ raft, config, logger }) {
  const servicio = config.serviceName;
  // Tiene que cubrir la espera del lock y el commit en el Leader (presupuesto de tiempos).
  const timeoutMs = config.lockEsperaMs + config.raft.commitTimeoutMs + 300;

  return async function reenviarAlLeader(req, res, next) {
    if (raft.esLeader()) return next();

    const leader = raft.leader();
    const operacion = `${req.method} ${req.path}`;

    if (!leader || !leader.apiUrl || req.get('X-Reenviado-Por')) {
      logger.warn('Escritura rechazada: no hay Leader disponible', { operacion, leader: leader?.id ?? null });
      return res.status(503).json({ error: 'Inventario sin Leader disponible: reintentá en unos segundos', servicio });
    }

    try {
      const respuesta = await fetch(`${leader.apiUrl}${req.originalUrl}`, {
        method: req.method,
        // El Authorization original viaja al Leader, que vuelve a validar el token: no confía en que
        // el follower ya lo hizo (D13). Sin este header, toda escritura por un follower daría 401.
        headers: {
          'Content-Type': 'application/json',
          'X-Reenviado-Por': config.raftNodoId,
          ...(req.get('Authorization') ? { Authorization: req.get('Authorization') } : {}),
        },
        body: ['GET', 'HEAD', 'DELETE'].includes(req.method) ? undefined : JSON.stringify(req.body ?? {}),
        signal: AbortSignal.timeout(timeoutMs),
      });
      const cuerpo = await respuesta.text();
      logger.info('Escritura reenviada al Leader', { operacion, leader: leader.id, status: respuesta.status });
      res.status(respuesta.status);
      return cuerpo ? res.type('application/json').send(cuerpo) : res.end();
    } catch (err) {
      const causa = err.name === 'TimeoutError' ? `sin respuesta en ${timeoutMs} ms` : err.cause?.code || err.message;
      logger.warn('No se pudo reenviar al Leader', { operacion, leader: leader.id, error: causa });
      return res.status(503).json({ error: 'Leader de Inventario no disponible: reintentá en unos segundos', servicio });
    }
  };
}

module.exports = { crearReenviarAlLeader };
