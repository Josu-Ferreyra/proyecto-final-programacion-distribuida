// Node es single-thread, pero entre dos "await" (por ejemplo, persistir el término en
// Mongo) puede colarse otro RPC o un timer. Este mutex serializa las secciones que
// leen-modifican-persisten el estado Raft para que no se intercalen.
// No es reentrante: dentro de run() no hay que volver a llamar a run().
class Mutex {
  constructor() {
    this.cola = Promise.resolve();
  }

  run(fn) {
    const resultado = this.cola.then(fn);
    this.cola = resultado.catch(() => {});
    return resultado;
  }
}

module.exports = { Mutex };
