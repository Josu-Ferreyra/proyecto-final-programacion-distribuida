// Escenario I (integración Redis + Raft): dispara compras concurrentes contra el
// Leader y muestra el stock antes/después en los TRES nodos.
//
// Uso:
//   node scripts/test-concurrencia.js <id>:<cantidad> [<id>:<cantidad> ...]
//
// Ejemplos:
//   node scripts/test-concurrencia.js <id>:6 <id>:6     -> dos compras concurrentes sobre el mismo producto
//   node scripts/test-concurrencia.js <idA>:3 <idB>:3   -> productos distintos (no compiten por el lock)
//
// Variable opcional: API_BASE_URL para apuntar a un nodo puntual en vez de buscar al Leader.

const { buscarLeader, nodos } = require('./lib/cliente-cluster');

async function stockEnNodos(id) {
  const valores = await Promise.all(
    nodos.map(async (n) => {
      try {
        const res = await fetch(`${n.apiUrl}/api/productos/${id}`, { signal: AbortSignal.timeout(2000) });
        const data = await res.json();
        return `${n.id}=${res.ok ? `${data.stock} (v${data.version})` : res.status}`;
      } catch {
        return `${n.id}=caído`;
      }
    })
  );
  return valores.join('  ');
}

async function main() {
  const args = process.argv.slice(2);

  if (args.length === 0) {
    console.log('Uso: node scripts/test-concurrencia.js <id>:<cantidad> [<id>:<cantidad> ...]');
    process.exit(1);
  }

  const operaciones = args.map((arg) => {
    const separador = arg.lastIndexOf(':');
    return { id: arg.slice(0, separador), cantidad: Number(arg.slice(separador + 1)) };
  });

  const base = process.env.API_BASE_URL || (await buscarLeader()).apiUrl;
  const url = `${base}/api/productos`;
  const idsInvolucrados = [...new Set(operaciones.map((op) => op.id))];

  console.log('Estado inicial (stock y versión en cada réplica):');
  for (const id of idsInvolucrados) console.log(`  producto ${id}: ${await stockEnNodos(id)}`);

  console.log(`\nDisparando ${operaciones.length} compras en paralelo contra ${url}...`);
  const inicio = Date.now();

  const resultados = await Promise.all(
    operaciones.map(async (op, index) => {
      const t0 = Date.now();
      const res = await fetch(`${url}/${op.id}/comprar`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cantidad: op.cantidad }),
      });
      const data = await res.json();
      return { index, ...op, status: res.status, ms: Date.now() - t0, raftIndex: res.headers.get('x-raft-index'), data };
    })
  );

  console.log(`\nResultados (${Date.now() - inicio}ms en total):`);
  resultados.forEach((r) => {
    const entrada = r.raftIndex ? ` [entrada Raft ${r.raftIndex}]` : '';
    console.log(`  [${r.index}] producto ${r.id} cantidad=${r.cantidad} -> ${r.status} en ${r.ms}ms${entrada} ${JSON.stringify(r.data)}`);
  });

  // Los followers aplican cuando se enteran del commit (próximo AppendEntries).
  await new Promise((r) => setTimeout(r, 2500));

  console.log('\nEstado final (stock y versión en cada réplica):');
  for (const id of idsInvolucrados) console.log(`  producto ${id}: ${await stockEnNodos(id)}`);
}

main().catch((err) => {
  console.error('Error ejecutando la prueba:', err.message);
  process.exit(1);
});
