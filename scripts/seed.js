// Carga productos iniciales A TRAVÉS DEL LEADER (POST /api/productos), para que pasen
// por el log Raft como cualquier otra escritura. Nunca se inserta directo en una base:
// eso dejaría a las réplicas divergentes.
//
// Uso: npm run seed   (con el cluster levantado)

const { buscarLeader } = require('./lib/cliente-cluster');

const PRODUCTOS_INICIALES = [
  { nombre: 'Teclado mecánico', precio: 25000, stock: 10, categoria: 'periferico' },
  { nombre: 'Mouse inalámbrico', precio: 12000, stock: 10, categoria: 'periferico' },
  { nombre: 'Monitor 24"', precio: 90000, stock: 10, categoria: 'monitor' },
];

async function main() {
  const leader = await buscarLeader();
  console.log(`Leader: ${leader.id} (${leader.apiUrl})`);

  for (const producto of PRODUCTOS_INICIALES) {
    const res = await fetch(`${leader.apiUrl}/api/productos`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(producto),
    });
    const data = await res.json();
    const indice = res.headers.get('x-raft-index');
    console.log(`  ${res.status} ${producto.nombre} -> ${data.id || data.error}${indice ? ` (entrada Raft ${indice})` : ''}`);
  }
}

main().catch((err) => {
  console.error('Error ejecutando el seed:', err.message);
  process.exit(1);
});
