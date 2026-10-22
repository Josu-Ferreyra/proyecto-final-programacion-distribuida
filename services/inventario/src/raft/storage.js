// Persistencia del estado Raft en la base MongoDB del nodo (colecciones raft_estado y
// raft_log, en la misma base que los datos del servicio: D2). Heredada del TP4 sin cambios.
//
// Lo que sobrevive a un reinicio:
//   - currentTerm y votedFor  -> sin esto un nodo reiniciado podría votar dos veces en
//                                el mismo término o hacer retroceder el término.
//   - el log (raft_log)       -> las entradas que el nodo aceptó ya cuentan para una
//                                mayoría; perderlas podría "des-confirmar" algo committed.
//   - commitIndex/lastApplied -> no son obligatorios en Raft (se reconstruyen), pero
//                                persistirlos simplifica la recuperación y evita volver
//                                a aplicar entradas sobre la base de negocio.
//
// Lo que NO se persiste (se reconstruye): rol, Leader conocido, nextIndex/matchIndex
// del Leader, votos recibidos y timers.

const mongoose = require('mongoose');

const estadoSchema = new mongoose.Schema(
  {
    _id: { type: String, default: 'estado' },
    currentTerm: { type: Number, default: 0 },
    votedFor: { type: String, default: null },
    commitIndex: { type: Number, default: 0 },
    lastApplied: { type: Number, default: 0 },
  },
  { collection: 'raft_estado', versionKey: false }
);

const entradaSchema = new mongoose.Schema(
  {
    index: { type: Number, required: true, unique: true },
    term: { type: Number, required: true },
    comando: { type: mongoose.Schema.Types.Mixed, required: true },
    creadaEn: { type: Date, required: true },
  },
  { collection: 'raft_log', versionKey: false, minimize: false }
);

const RaftEstado = mongoose.model('RaftEstado', estadoSchema);
const RaftEntrada = mongoose.model('RaftEntrada', entradaSchema);

function aEntradaPlana(doc) {
  return { index: doc.index, term: doc.term, comando: doc.comando, creadaEn: new Date(doc.creadaEn).toISOString() };
}

async function cargar() {
  const estado = (await RaftEstado.findById('estado').lean()) || {};
  const entradas = await RaftEntrada.find().sort({ index: 1 }).lean();
  return {
    currentTerm: estado.currentTerm || 0,
    votedFor: estado.votedFor || null,
    commitIndex: estado.commitIndex || 0,
    lastApplied: estado.lastApplied || 0,
    log: entradas.map(aEntradaPlana),
  };
}

async function guardarEstado(cambios) {
  await RaftEstado.updateOne({ _id: 'estado' }, { $set: cambios }, { upsert: true });
}

async function agregarEntradas(entradas) {
  if (entradas.length === 0) return;
  await RaftEntrada.insertMany(entradas.map((e) => ({ ...e, creadaEn: new Date(e.creadaEn) })), { ordered: true });
}

// Borra desde "index" en adelante (entradas en conflicto con las del Leader).
async function truncarDesde(index) {
  await RaftEntrada.deleteMany({ index: { $gte: index } });
}

module.exports = { cargar, guardarEstado, agregarEntradas, truncarDesde, RaftEstado, RaftEntrada };
