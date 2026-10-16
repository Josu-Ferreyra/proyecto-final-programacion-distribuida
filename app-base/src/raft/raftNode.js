// Implementación educativa y simplificada de Raft para un cluster fijo de 3 nodos.
//
// Responsabilidades de esta clase (el "protocolo"):
//   - roles FOLLOWER / CANDIDATE / LEADER, término y voto          (Hito 2)
//   - heartbeats del Leader y failover por election timeout        (Hito 3)
//   - log replicado, chequeo de continuidad y commit por mayoría   (Hito 4)
//   - entregar las entradas committed, en orden, a la State Machine (Hito 5)
//   - recuperación de followers atrasados y estado persistente     (Hito 6)
//
// Lo que NO hace: tocar la base de negocio. Eso es trabajo de la State Machine, que
// solo recibe entradas ya committed.

const logger = require('../lib/logger');
const { Mutex } = require('./mutex');

const ROLES = Object.freeze({
  FOLLOWER: 'FOLLOWER',
  CANDIDATE: 'CANDIDATE',
  LEADER: 'LEADER',
});

class ErrorRaft extends Error {
  constructor(codigo, mensaje, extra = {}) {
    super(mensaje);
    this.codigo = codigo;
    Object.assign(this, extra);
  }
}

function numeroEnv(nombre, porDefecto) {
  const valor = Number(process.env[nombre]);
  return Number.isFinite(valor) && valor > 0 ? valor : porDefecto;
}

class RaftNode {
  constructor({ nodo, storage, stateMachine, rpc }) {
    this.id = nodo.id;
    this.nodo = nodo;
    this.peers = nodo.peers;
    this.tamanioCluster = nodo.tamanioCluster;
    this.mayoria = Math.floor(this.tamanioCluster / 2) + 1;

    this.storage = storage;
    this.stateMachine = stateMachine;
    this.rpc = rpc;

    this.config = {
      electionTimeoutMinMs: numeroEnv('RAFT_ELECTION_TIMEOUT_MIN_MS', 3000),
      electionTimeoutMaxMs: numeroEnv('RAFT_ELECTION_TIMEOUT_MAX_MS', 6000),
      heartbeatMs: numeroEnv('RAFT_HEARTBEAT_MS', 1000),
      commitTimeoutMs: numeroEnv('RAFT_COMMIT_TIMEOUT_MS', 5000),
      maxEntradasPorMensaje: numeroEnv('RAFT_MAX_ENTRADAS_POR_MENSAJE', 50),
    };

    // Estado persistente (se carga desde Mongo en iniciar()).
    this.currentTerm = 0;
    this.votedFor = null;
    this.log = []; // log[i - 1] es la entrada de índice i (los índices arrancan en 1)
    this.commitIndex = 0;
    this.lastApplied = 0;

    // Estado volátil (se reconstruye).
    this.rol = ROLES.FOLLOWER;
    this.leaderId = null;
    this.votos = new Set();
    this.nextIndex = {};
    this.matchIndex = {};
    this.peerInfo = Object.fromEntries(
      this.peers.map((p) => [p.id, { alcanzable: null, ultimaRespuesta: null, enVuelo: false, pendiente: false }])
    );

    this.mutex = new Mutex();
    this.esperas = new Map(); // index -> { term, resolve, reject, timer }  (clientes esperando el commit)
    this.aplicando = false;
    this.reaplicar = false;

    this.timerEleccion = null;
    this.genTimer = 0;
    this.timeoutActualMs = null;
    this.timerHeartbeat = null;
    this.detenido = false;

    this.stats = {
      eleccionesIniciadas: 0,
      heartbeatsEnviados: 0,
      heartbeatsRecibidos: 0,
      ultimoMensajeDelLeader: null,
      ultimoCambioDeRol: null,
    };
  }

  // ---------------------------------------------------------------- helpers de log

  ultimoIndice() {
    return this.log.length;
  }

  terminoEn(index) {
    if (index === 0) return 0;
    const entrada = this.log[index - 1];
    return entrada ? entrada.term : undefined;
  }

  ultimoTermino() {
    return this.terminoEn(this.ultimoIndice());
  }

  esLeader() {
    return this.rol === ROLES.LEADER;
  }

  infoNodo(id) {
    if (!id) return null;
    const nodo = id === this.id ? this.nodo : this.peers.find((p) => p.id === id);
    if (!nodo) return { id };
    return { id, apiUrl: nodo.apiUrl, apiHttpsUrl: `https://${nodo.host}:${nodo.apiHttpsPort}` };
  }

  // ---------------------------------------------------------------- arranque / parada

  async iniciar() {
    const persistido = await this.storage.cargar();

    persistido.log.forEach((e, i) => {
      if (e.index !== i + 1) {
        throw new Error(`Log persistido inconsistente: se esperaba índice ${i + 1} y se encontró ${e.index}`);
      }
    });

    this.currentTerm = persistido.currentTerm;
    this.votedFor = persistido.votedFor;
    this.log = persistido.log;
    this.commitIndex = Math.min(persistido.commitIndex, this.log.length);
    this.lastApplied = Math.min(persistido.lastApplied, this.commitIndex);

    logger.info('Estado Raft recuperado desde Mongo', {
      term: this.currentTerm,
      votedFor: this.votedFor,
      entradasEnLog: this.log.length,
      commitIndex: this.commitIndex,
      lastApplied: this.lastApplied,
    });

    // Si el proceso se cayó entre el commit y la aplicación, se completa ahora.
    await this._aplicarPendientes();
  }

  arrancar() {
    this.stats.ultimoCambioDeRol = new Date().toISOString();
    logger.info('Nodo iniciado como FOLLOWER', {
      term: this.currentTerm,
      electionTimeoutMs: [this.config.electionTimeoutMinMs, this.config.electionTimeoutMaxMs],
      heartbeatMs: this.config.heartbeatMs,
      mayoria: `${this.mayoria}/${this.tamanioCluster}`,
    });
    this._reiniciarTimerEleccion();
  }

  detener() {
    this.detenido = true;
    this._detenerTimerEleccion();
    clearInterval(this.timerHeartbeat);
    this._rechazarEsperas('El nodo se está deteniendo');
  }

  // ---------------------------------------------------------------- timers

  _reiniciarTimerEleccion() {
    if (this.detenido) return;
    clearTimeout(this.timerEleccion);
    const gen = ++this.genTimer;
    const { electionTimeoutMinMs: min, electionTimeoutMaxMs: max } = this.config;
    // Aleatorio en cada reinicio: los nodos no vencen a la vez y se evitan empates repetidos.
    this.timeoutActualMs = Math.round(min + Math.random() * (max - min));
    this.timerEleccion = setTimeout(() => {
      this._alVencerTimeout(gen).catch((err) => logger.error('Error iniciando elección', { error: err.message }));
    }, this.timeoutActualMs);
  }

  _detenerTimerEleccion() {
    clearTimeout(this.timerEleccion);
    this.timerEleccion = null;
    this.genTimer++;
  }

  // ---------------------------------------------------------------- transiciones de rol

  _cambiarRol(nuevo, motivo) {
    if (this.rol === nuevo) return;
    logger.info('Cambio de rol', { de: this.rol, a: nuevo, term: this.currentTerm, motivo });
    this.rol = nuevo;
    this.stats.ultimoCambioDeRol = new Date().toISOString();
  }

  // Debe llamarse con el mutex tomado.
  async _pasarAFollower(term, motivo) {
    if (term > this.currentTerm) {
      await this.storage.guardarEstado({ currentTerm: term, votedFor: null });
      logger.info('Cambio de término', { de: this.currentTerm, a: term, motivo });
      this.currentTerm = term;
      this.votedFor = null;
      this.leaderId = null;
    }

    if (this.rol === ROLES.LEADER) {
      clearInterval(this.timerHeartbeat);
      this.timerHeartbeat = null;
      logger.info('Dejo de enviar heartbeats: ya no soy Leader', { term: this.currentTerm });
      this._rechazarEsperas('Se perdió el liderazgo antes de confirmar la operación');
    }

    if (this.rol !== ROLES.FOLLOWER) {
      this._cambiarRol(ROLES.FOLLOWER, motivo);
      this._reiniciarTimerEleccion();
    }
  }

  // ---------------------------------------------------------------- elección (Hito 2)

  async _alVencerTimeout(gen) {
    const solicitud = await this.mutex.run(async () => {
      // El timer pudo haberse reiniciado mientras este callback esperaba el mutex.
      if (this.detenido || gen !== this.genTimer || this.rol === ROLES.LEADER) return null;

      const nuevoTerm = this.currentTerm + 1;
      await this.storage.guardarEstado({ currentTerm: nuevoTerm, votedFor: this.id });

      const leaderAnterior = this.leaderId;
      this.currentTerm = nuevoTerm;
      this.votedFor = this.id;
      this.leaderId = null;
      this.votos = new Set([this.id]);
      this.stats.eleccionesIniciadas++;

      this._cambiarRol(ROLES.CANDIDATE, 'election timeout sin noticias de un Leader válido');
      logger.info('Election timeout vencido: inicio elección', {
        term: nuevoTerm,
        timeoutMs: this.timeoutActualMs,
        leaderAnterior,
        votos: `1/${this.tamanioCluster} (voto propio)`,
      });

      // Si la elección no se resuelve (voto dividido, peers caídos), se reintenta
      // con un término nuevo cuando vuelva a vencer este timer.
      this._reiniciarTimerEleccion();

      if (this.votos.size >= this.mayoria) {
        await this._convertirseEnLeader();
        return null;
      }

      return {
        term: nuevoTerm,
        candidateId: this.id,
        lastLogIndex: this.ultimoIndice(),
        lastLogTerm: this.ultimoTermino(),
      };
    });

    if (!solicitud) return;
    this.peers.forEach((peer) => {
      this._pedirVoto(peer, solicitud).catch((err) => logger.error('Error procesando voto', { peer: peer.id, error: err.message }));
    });
  }

  async _pedirVoto(peer, solicitud) {
    let resp;
    try {
      resp = await this.rpc.requestVote(peer, solicitud);
    } catch (err) {
      this._marcarAlcanzable(peer, false, err);
      return;
    }
    this._marcarAlcanzable(peer, true);

    await this.mutex.run(async () => {
      if (resp.term > this.currentTerm) {
        await this._pasarAFollower(resp.term, `${peer.id} informó un término mayor al responder el voto`);
        return;
      }
      if (this.rol !== ROLES.CANDIDATE || this.currentTerm !== solicitud.term) return; // respuesta vieja

      if (resp.voteGranted) {
        this.votos.add(peer.id);
        logger.info('Voto recibido', {
          de: peer.id,
          term: this.currentTerm,
          votos: `${this.votos.size}/${this.tamanioCluster}`,
          mayoriaNecesaria: this.mayoria,
        });
        if (this.votos.size >= this.mayoria) {
          await this._convertirseEnLeader();
        }
      } else {
        logger.info('Voto rechazado', { de: peer.id, term: this.currentTerm, motivo: resp.motivo });
      }
    });
  }

  // Debe llamarse con el mutex tomado.
  async _convertirseEnLeader() {
    this._cambiarRol(ROLES.LEADER, `mayoría alcanzada (${this.votos.size}/${this.tamanioCluster})`);
    this.leaderId = this.id;
    this._detenerTimerEleccion();

    this.peers.forEach((p) => {
      this.nextIndex[p.id] = this.ultimoIndice() + 1;
      this.matchIndex[p.id] = 0;
    });

    logger.info('Soy LEADER', {
      term: this.currentTerm,
      votos: [...this.votos],
      mayoria: `${this.mayoria}/${this.tamanioCluster}`,
    });

    // Entrada vacía del término nuevo: un Leader solo cuenta réplicas de entradas de su
    // propio término, así que esta NOOP permite confirmar (indirectamente) lo que haya
    // quedado sin commit de términos anteriores.
    await this._agregarAlLogLocal({ tipo: 'NOOP', motivo: `inicio del término ${this.currentTerm}` });

    this.timerHeartbeat = setInterval(() => this._replicarATodos(), this.config.heartbeatMs);
    setImmediate(() => this._replicarATodos());
  }

  // RPC RequestVote (lado receptor).
  handleRequestVote(solicitud) {
    return this.mutex.run(async () => {
      const { term, candidateId, lastLogIndex, lastLogTerm } = solicitud;

      if (term > this.currentTerm) {
        await this._pasarAFollower(term, `RequestVote de ${candidateId} con término mayor`);
      }

      const miUltimoIndice = this.ultimoIndice();
      const miUltimoTermino = this.ultimoTermino();
      const logDelCandidatoAlDia =
        lastLogTerm > miUltimoTermino || (lastLogTerm === miUltimoTermino && lastLogIndex >= miUltimoIndice);

      let concedido = false;
      let motivo;

      if (term < this.currentTerm) {
        motivo = `término del candidato (${term}) menor al local (${this.currentTerm})`;
      } else if (this.votedFor && this.votedFor !== candidateId) {
        motivo = `ya voté por ${this.votedFor} en el término ${this.currentTerm}`;
      } else if (!logDelCandidatoAlDia) {
        motivo = `log del candidato (último ${lastLogIndex}/t${lastLogTerm}) menos actualizado que el mío (último ${miUltimoIndice}/t${miUltimoTermino})`;
      } else {
        if (this.votedFor !== candidateId) {
          // El voto se persiste ANTES de responder: si el nodo se reinicia no puede votar a otro en este término.
          await this.storage.guardarEstado({ votedFor: candidateId });
          this.votedFor = candidateId;
        }
        concedido = true;
        motivo = 'voto concedido';
        this._reiniciarTimerEleccion();
      }

      logger.info(concedido ? 'Voto concedido' : 'Voto denegado', { candidato: candidateId, term: this.currentTerm, motivo });
      return { term: this.currentTerm, voteGranted: concedido, motivo };
    });
  }

  // ---------------------------------------------------------------- replicación (Hitos 3, 4 y 6A)

  _replicarATodos() {
    if (this.rol !== ROLES.LEADER || this.detenido) return;
    this.peers.forEach((peer) => {
      this._replicarA(peer).catch((err) => logger.error('Error replicando', { peer: peer.id, error: err.message }));
    });
  }

  // Un solo AppendEntries en vuelo por peer. Si mientras tanto hay novedades
  // (nueva entrada o heartbeat), se marca "pendiente" y se reenvía al terminar.
  async _replicarA(peer) {
    const info = this.peerInfo[peer.id];
    if (info.enVuelo) {
      info.pendiente = true;
      return;
    }
    info.enVuelo = true;
    try {
      let seguir = true;
      while (seguir && this.rol === ROLES.LEADER && !this.detenido) {
        info.pendiente = false;
        const resultado = await this._enviarAppendEntries(peer);
        seguir = resultado === 'reintentar' || info.pendiente;
      }
    } finally {
      info.enVuelo = false;
    }
  }

  async _enviarAppendEntries(peer) {
    if (this.rol !== ROLES.LEADER) return 'fin';

    const term = this.currentTerm;
    const next = this.nextIndex[peer.id];
    const prevLogIndex = next - 1;
    const prevLogTerm = this.terminoEn(prevLogIndex);
    const entries = this.log.slice(next - 1, next - 1 + this.config.maxEntradasPorMensaje);

    const solicitud = { term, leaderId: this.id, prevLogIndex, prevLogTerm, entries, leaderCommit: this.commitIndex };

    if (entries.length === 0) {
      this.stats.heartbeatsEnviados++;
      logger.debug('Heartbeat enviado', { a: peer.id, term, commitIndex: this.commitIndex });
    } else {
      // Mientras el peer está caído el reintento se repite en cada heartbeat: va a debug.
      const nivel = this.peerInfo[peer.id].alcanzable === false ? 'debug' : 'info';
      logger.log(nivel, 'AppendEntries con entradas', {
        a: peer.id,
        term,
        desde: next,
        hasta: next + entries.length - 1,
        prevLogIndex,
        prevLogTerm,
        leaderCommit: this.commitIndex,
      });
    }

    let resp;
    try {
      resp = await this.rpc.appendEntries(peer, solicitud);
    } catch (err) {
      this._marcarAlcanzable(peer, false, err);
      return 'fin';
    }
    this._marcarAlcanzable(peer, true);

    return this.mutex.run(async () => {
      if (resp.term > this.currentTerm) {
        await this._pasarAFollower(resp.term, `${peer.id} respondió AppendEntries con un término mayor`);
        return 'fin';
      }
      if (this.rol !== ROLES.LEADER || this.currentTerm !== term) return 'fin';

      if (resp.success) {
        const match = prevLogIndex + entries.length;
        if (match > this.matchIndex[peer.id]) this.matchIndex[peer.id] = match;
        this.nextIndex[peer.id] = Math.max(this.nextIndex[peer.id], match + 1);
        if (entries.length > 0) {
          logger.info('Follower confirmó entradas', {
            peer: peer.id,
            matchIndex: this.matchIndex[peer.id],
            nextIndex: this.nextIndex[peer.id],
          });
        }
        await this._avanzarCommit();
        return this.nextIndex[peer.id] <= this.ultimoIndice() ? 'reintentar' : 'fin';
      }

      // Rechazo por inconsistencia: el follower no tiene (o tiene distinta) la entrada
      // prevLogIndex. Se retrocede el punto de envío y se reintenta. Si el follower
      // informó su último índice, se salta directo ahí (sigue siendo correcto).
      const anterior = this.nextIndex[peer.id];
      const pista = Number.isInteger(resp.ultimoIndice) ? resp.ultimoIndice + 1 : anterior - 1;
      this.nextIndex[peer.id] = Math.max(1, Math.min(anterior - 1, pista));
      logger.warn('Follower rechazó AppendEntries por inconsistencia: retrocedo nextIndex y reintento', {
        peer: peer.id,
        prevLogIndex,
        prevLogTerm,
        motivo: resp.motivo,
        nextIndexAnterior: anterior,
        nextIndexNuevo: this.nextIndex[peer.id],
      });
      return 'reintentar';
    });
  }

  _marcarAlcanzable(peer, ok, err) {
    const info = this.peerInfo[peer.id];
    if (ok) {
      if (info.alcanzable === false) {
        logger.info('Peer volvió a responder', { peer: peer.id, rol: this.rol, term: this.currentTerm });
      }
      info.ultimaRespuesta = new Date().toISOString();
    } else if (info.alcanzable !== false) {
      logger.warn('Peer no responde', { peer: peer.id, rol: this.rol, error: err && err.message });
    }
    info.alcanzable = ok;
  }

  // Debe llamarse con el mutex tomado.
  async _avanzarCommit() {
    if (this.rol !== ROLES.LEADER) return;

    for (let n = this.ultimoIndice(); n > this.commitIndex; n--) {
      // Solo se cuentan réplicas de entradas del término actual (regla de Raft);
      // las anteriores quedan committed indirectamente al confirmarse una posterior.
      if (this.terminoEn(n) !== this.currentTerm) break;

      const replicas = 1 + this.peers.filter((p) => this.matchIndex[p.id] >= n).length;
      if (replicas >= this.mayoria) {
        const anterior = this.commitIndex;
        await this.storage.guardarEstado({ commitIndex: n });
        this.commitIndex = n;
        logger.info('Commit avanzado por mayoría', {
          desde: anterior + 1,
          hasta: n,
          replicas: `${replicas}/${this.tamanioCluster}`,
          term: this.currentTerm,
        });
        this._dispararAplicacion();
        break;
      }
    }
  }

  // RPC AppendEntries (lado receptor): heartbeat + replicación + avance de commit.
  handleAppendEntries(solicitud) {
    return this.mutex.run(async () => {
      const { term, leaderId, prevLogIndex, prevLogTerm, leaderCommit } = solicitud;
      const entries = solicitud.entries || [];

      if (term < this.currentTerm) {
        logger.info('AppendEntries rechazado: viene de un Leader con término viejo', {
          de: leaderId,
          suTerm: term,
          miTerm: this.currentTerm,
        });
        return { term: this.currentTerm, success: false, ultimoIndice: this.ultimoIndice(), motivo: 'término viejo' };
      }

      if (term > this.currentTerm || this.rol !== ROLES.FOLLOWER) {
        await this._pasarAFollower(term, `AppendEntries válido de ${leaderId}`);
      }

      if (this.leaderId !== leaderId) {
        logger.info('Leader reconocido', { leader: leaderId, term: this.currentTerm });
        this.leaderId = leaderId;
      }

      // Mensaje válido del Leader del término actual: se renueva el election timer.
      this._reiniciarTimerEleccion();
      this.stats.ultimoMensajeDelLeader = new Date().toISOString();
      if (entries.length === 0) {
        this.stats.heartbeatsRecibidos++;
        logger.debug('Heartbeat recibido', { de: leaderId, term, leaderCommit });
      }

      // Chequeo de continuidad: la entrada previa tiene que coincidir.
      if (prevLogIndex > this.ultimoIndice()) {
        logger.warn('AppendEntries rechazado: me falta la entrada previa', {
          prevLogIndex,
          miUltimoIndice: this.ultimoIndice(),
        });
        return {
          term: this.currentTerm,
          success: false,
          ultimoIndice: this.ultimoIndice(),
          motivo: `falta la entrada ${prevLogIndex} (mi log llega hasta ${this.ultimoIndice()})`,
        };
      }
      if (prevLogIndex > 0 && this.terminoEn(prevLogIndex) !== prevLogTerm) {
        logger.warn('AppendEntries rechazado: la entrada previa tiene otro término', {
          prevLogIndex,
          terminoLocal: this.terminoEn(prevLogIndex),
          terminoLeader: prevLogTerm,
        });
        return {
          term: this.currentTerm,
          success: false,
          ultimoIndice: prevLogIndex - 1,
          motivo: `la entrada ${prevLogIndex} tiene término ${this.terminoEn(prevLogIndex)} y no ${prevLogTerm}`,
        };
      }

      let nuevas = [];
      for (let i = 0; i < entries.length; i++) {
        const index = prevLogIndex + 1 + i;
        if (index <= this.ultimoIndice()) {
          if (this.terminoEn(index) === entries[i].term) continue; // ya la tengo
          logger.warn('Conflicto en el log: descarto mis entradas desde este índice', {
            index,
            terminoLocal: this.terminoEn(index),
            terminoLeader: entries[i].term,
          });
          await this.storage.truncarDesde(index);
          this.log.length = index - 1;
          this._rechazarEsperasDesde(index);
        }
        nuevas = entries.slice(i).map((e, j) => ({
          index: index + j,
          term: e.term,
          comando: e.comando,
          creadaEn: e.creadaEn,
        }));
        break;
      }

      if (nuevas.length > 0) {
        await this.storage.agregarEntradas(nuevas);
        this.log.push(...nuevas);
        logger.info('Entradas replicadas en mi log (todavía no committed)', {
          de: leaderId,
          desde: nuevas[0].index,
          hasta: nuevas[nuevas.length - 1].index,
          term,
        });
      }

      const ultimoNuevo = prevLogIndex + entries.length;
      if (leaderCommit > this.commitIndex) {
        const nuevoCommit = Math.min(leaderCommit, ultimoNuevo);
        if (nuevoCommit > this.commitIndex) {
          await this.storage.guardarEstado({ commitIndex: nuevoCommit });
          logger.info('Commit avanzado (informado por el Leader)', {
            desde: this.commitIndex + 1,
            hasta: nuevoCommit,
            leaderCommit,
          });
          this.commitIndex = nuevoCommit;
          this._dispararAplicacion();
        }
      }

      return { term: this.currentTerm, success: true, ultimoIndice: this.ultimoIndice() };
    });
  }

  // ---------------------------------------------------------------- propuestas de clientes

  // El Leader agrega el comando a su log y devuelve una promesa que se resuelve cuando
  // la entrada quedó committed Y aplicada en la State Machine local (con su resultado).
  async proponer(comando) {
    return this.mutex.run(async () => {
      if (this.rol !== ROLES.LEADER) {
        throw new ErrorRaft('NO_SOY_LEADER', 'Este nodo no es el Leader', { leader: this.infoNodo(this.leaderId) });
      }

      const entrada = await this._agregarAlLogLocal(comando);

      const promesa = new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          this.esperas.delete(entrada.index);
          logger.warn('Entrada sin confirmar dentro del tiempo límite (no se alcanzó quorum)', {
            index: entrada.index,
            term: entrada.term,
            commitTimeoutMs: this.config.commitTimeoutMs,
            replicas: this._replicasDe(entrada.index).length,
          });
          reject(
            new ErrorRaft(
              'SIN_QUORUM',
              `No se alcanzó mayoría en ${this.config.commitTimeoutMs} ms: la entrada ${entrada.index} quedó en el log del Leader sin confirmar y no se aplicó`,
              { index: entrada.index, term: entrada.term }
            )
          );
        }, this.config.commitTimeoutMs);
        this.esperas.set(entrada.index, { term: entrada.term, resolve, reject, timer });
      });
      // Evita un "unhandled rejection" si se rechaza antes de que el caller haga await.
      promesa.catch(() => {});

      await this._avanzarCommit(); // en un cluster de 1 nodo la mayoría es inmediata
      setImmediate(() => this._replicarATodos());
      return { entrada, promesa };
    }).then(({ promesa }) => promesa);
  }

  // Debe llamarse con el mutex tomado.
  async _agregarAlLogLocal(comando) {
    const entrada = {
      index: this.ultimoIndice() + 1,
      term: this.currentTerm,
      comando,
      creadaEn: new Date().toISOString(),
    };
    await this.storage.agregarEntradas([entrada]);
    this.log.push(entrada);
    logger.info('Entrada agregada al log local del Leader (todavía no replicada ni committed)', {
      index: entrada.index,
      term: entrada.term,
      tipo: comando.tipo,
    });
    return entrada;
  }

  _resolverEspera(entrada, resultado) {
    const espera = this.esperas.get(entrada.index);
    if (!espera) return;
    this.esperas.delete(entrada.index);
    clearTimeout(espera.timer);
    if (espera.term !== entrada.term) {
      espera.reject(new ErrorRaft('LIDERAZGO_PERDIDO', 'La entrada propuesta fue reemplazada por otra de un Leader nuevo'));
    } else {
      espera.resolve({ ...resultado, index: entrada.index, term: entrada.term });
    }
  }

  _rechazarEsperas(motivo) {
    for (const [index, espera] of this.esperas) {
      clearTimeout(espera.timer);
      espera.reject(new ErrorRaft('LIDERAZGO_PERDIDO', motivo, { index }));
    }
    this.esperas.clear();
  }

  _rechazarEsperasDesde(desde) {
    for (const [index, espera] of this.esperas) {
      if (index >= desde) {
        clearTimeout(espera.timer);
        espera.reject(new ErrorRaft('LIDERAZGO_PERDIDO', 'La entrada propuesta fue reemplazada por otra de un Leader nuevo', { index }));
        this.esperas.delete(index);
      }
    }
  }

  // ---------------------------------------------------------------- aplicación (Hito 5)

  _dispararAplicacion() {
    this._aplicarPendientes().catch((err) => logger.error('Error aplicando entradas', { error: err.message }));
  }

  // Aplica en orden estricto (lastApplied + 1, + 2, ...) todo lo que esté committed.
  async _aplicarPendientes() {
    if (this.aplicando) {
      this.reaplicar = true;
      return;
    }
    this.aplicando = true;
    try {
      do {
        this.reaplicar = false;
        while (this.lastApplied < this.commitIndex && !this.detenido) {
          const index = this.lastApplied + 1;
          const entrada = this.log[index - 1];

          let resultado;
          try {
            resultado = await this.stateMachine.aplicar(entrada);
          } catch (err) {
            // Error de infraestructura (no de negocio): no se avanza lastApplied, se reintenta.
            logger.error('No se pudo aplicar la entrada, se reintenta en 1s', { index, error: err.message });
            setTimeout(() => this._dispararAplicacion(), 1000);
            return;
          }

          await this.storage.guardarEstado({ lastApplied: index });
          this.lastApplied = index;
          logger.info('Entrada aplicada a la State Machine', {
            index,
            term: entrada.term,
            tipo: entrada.comando.tipo,
            resultado: resultado.ok ? 'ok' : `rechazada por negocio (${resultado.status})`,
          });
          this._resolverEspera(entrada, resultado);
        }
      } while (this.reaplicar && !this.detenido);
    } finally {
      this.aplicando = false;
    }
  }

  // ---------------------------------------------------------------- diagnóstico

  _replicasDe(index) {
    if (this.rol !== ROLES.LEADER) return [this.id];
    return [this.id, ...this.peers.filter((p) => this.matchIndex[p.id] >= index).map((p) => p.id)];
  }

  estado() {
    return {
      nodo: this.id,
      rol: this.rol,
      termino: this.currentTerm,
      votoEmitido: this.votedFor,
      leaderConocido: this.infoNodo(this.leaderId),
      cluster: {
        tamanio: this.tamanioCluster,
        mayoria: this.mayoria,
        peers: this.peers.map((p) => p.id),
      },
      log: {
        ultimoIndice: this.ultimoIndice(),
        ultimoTermino: this.ultimoTermino(),
        commitIndex: this.commitIndex,
        lastApplied: this.lastApplied,
        entradasSinCommit: this.ultimoIndice() - this.commitIndex,
      },
      heartbeats: { ...this.stats },
      electionTimeout: {
        minMs: this.config.electionTimeoutMinMs,
        maxMs: this.config.electionTimeoutMaxMs,
        actualMs: this.rol === ROLES.LEADER ? null : this.timeoutActualMs,
      },
      replicacion:
        this.rol === ROLES.LEADER
          ? this.peers.map((p) => ({
              peer: p.id,
              nextIndex: this.nextIndex[p.id],
              matchIndex: this.matchIndex[p.id],
              alcanzable: this.peerInfo[p.id].alcanzable,
              ultimaRespuesta: this.peerInfo[p.id].ultimaRespuesta,
            }))
          : null,
      persistencia: { mongoDb: this.nodo.dbName },
    };
  }

  // Cada entrada con su situación: LOCAL (solo en el Leader), REPLICADA (en más de un
  // nodo pero sin commit), COMMITTED (confirmada por mayoría) o APLICADA (ya impactó
  // en la base de negocio). Un follower no sabe en cuántos nodos está una entrada: para
  // él una entrada sin commit figura como RECIBIDA.
  entradasLog({ desde = 1, hasta = this.ultimoIndice() } = {}) {
    const inicio = Math.max(1, desde);
    const fin = Math.min(this.ultimoIndice(), hasta);
    const resultado = [];
    for (let i = inicio; i <= fin; i++) {
      const e = this.log[i - 1];
      let estado;
      if (i <= this.lastApplied) estado = 'APLICADA';
      else if (i <= this.commitIndex) estado = 'COMMITTED';
      else if (this.rol === ROLES.LEADER) estado = this._replicasDe(i).length > 1 ? 'REPLICADA' : 'LOCAL';
      else estado = 'RECIBIDA';
      const item = { index: e.index, term: e.term, estado, comando: e.comando, creadaEn: e.creadaEn };
      if (this.rol === ROLES.LEADER) item.presenteEn = this._replicasDe(i);
      resultado.push(item);
    }
    return resultado;
  }
}

module.exports = { RaftNode, ROLES, ErrorRaft };
