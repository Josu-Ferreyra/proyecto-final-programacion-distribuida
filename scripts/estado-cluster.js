// Muestra en una tabla el estado Raft de los tres nodos (vía GET /api/cluster/estado).
// Uso: npm run estado            -> una vez
//      npm run estado -- --log   -> además, el log de cada nodo con el estado de cada entrada

const { estados } = require('./lib/cliente-cluster');

function resumenComando(c) {
  if (!c) return '';
  switch (c.tipo) {
    case 'NOOP':
      return 'NOOP';
    case 'CREAR_PRODUCTO':
      return `CREAR ${c.datos.nombre} (id ${c.id.slice(-6)})`;
    case 'ACTUALIZAR_PRODUCTO':
      return `ACTUALIZAR ${c.id.slice(-6)} ${JSON.stringify(c.cambios)}`;
    case 'ELIMINAR_PRODUCTO':
      return `ELIMINAR ${c.id.slice(-6)}`;
    case 'COMPRAR_PRODUCTO':
      return `COMPRAR ${c.id.slice(-6)} x${c.cantidad} (stock ${c.stockLeido} -> ${c.stockNuevo})`;
    default:
      return c.tipo;
  }
}

async function main() {
  const conLog = process.argv.includes('--log');
  const todos = await estados();

  console.log(`Estado del cluster - ${new Date().toLocaleTimeString('es-AR', { hour12: false })}`);
  console.table(
    todos.map(({ nodo, estado }) =>
      estado
        ? {
            nodo: nodo.id,
            rol: estado.rol,
            termino: estado.termino,
            voto: estado.votoEmitido,
            leader: estado.leaderConocido ? estado.leaderConocido.id : '-',
            ultimoIndice: estado.log.ultimoIndice,
            commitIndex: estado.log.commitIndex,
            lastApplied: estado.log.lastApplied,
            db: estado.persistencia.mongoDb,
          }
        : { nodo: nodo.id, rol: 'CAÍDO / sin respuesta' }
    )
  );

  const leader = todos.find((t) => t.estado && t.estado.rol === 'LEADER');
  if (leader) {
    console.log(`Replicación vista por el Leader (${leader.nodo.id}):`);
    console.table(leader.estado.replicacion);
  }

  if (conLog) {
    for (const { nodo, estado } of todos) {
      if (!estado) continue;
      const res = await fetch(`${nodo.apiUrl}/api/cluster/log`);
      const { entradas } = await res.json();
      console.log(`\nLog de ${nodo.id} (${estado.rol}):`);
      console.table(
        entradas.map((e) => ({
          index: e.index,
          term: e.term,
          estado: e.estado,
          ...(e.presenteEn ? { presenteEn: e.presenteEn.join(',') } : {}),
          comando: resumenComando(e.comando),
        }))
      );
    }
  }
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
