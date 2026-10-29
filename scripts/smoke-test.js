// Smoke test de punta a punta (prueba "CRUD / negocio" del TP6, con la seguridad del TP7).
//
// Verifica, con el código HTTP esperado en cada paso, que las operaciones principales
// siguen funcionando cruzando los cuatro servicios, y que la autenticación y la autorización
// rechazan lo que tienen que rechazar (401, 403 y la propiedad de la compra). Usa solo las APIs
// públicas y deja el stock como estaba (la compra de prueba se cancela).
//
// Requisito: haber corrido antes `node scripts/seed.js` (lee scripts/.datos-prueba.json y
// usa los clientes de prueba que registra el seed).
//
// Uso (Node 18+, sin dependencias), desde la raíz del repositorio:
//   node scripts/smoke-test.js
// Variables opcionales (por defecto, los puertos publicados por Compose y los locales):
//   CATALOGO_URL=http://localhost:3100   INVENTARIO_URL=http://localhost:3201
//   VENTAS_URL=http://localhost:3300     AUTH_URL=http://localhost:3400
//   INVENTARIO_NODOS=http://localhost:3201,http://localhost:3202,http://localhost:3203
//   ADMIN_EMAIL / ADMIN_PASSWORD (si no, los del .env de la raíz)
//
// Termina con "N OK, M FAIL" y código de salida 1 si algún paso falla.

const fs = require('node:fs');
const path = require('node:path');
const { AUTH, CLIENTES, credencialesAdmin, login } = require('./lib/auth-pruebas');

const quitarBarra = (url) => url.replace(/\/+$/, '');
const CATALOGO = quitarBarra(process.env.CATALOGO_URL || 'http://localhost:3100');
const INVENTARIO = quitarBarra(process.env.INVENTARIO_URL || 'http://localhost:3201');
const VENTAS = quitarBarra(process.env.VENTAS_URL || 'http://localhost:3300');
const NODOS = (process.env.INVENTARIO_NODOS || 'http://localhost:3201,http://localhost:3202,http://localhost:3203')
  .split(',')
  .map((u) => quitarBarra(u.trim()))
  .filter(Boolean);
const ARCHIVO = path.join(__dirname, '.datos-prueba.json');
const ID_INEXISTENTE = 'ffffffffffffffffffffffff';

let ok = 0;
let fallas = 0;

async function pedir(metodo, url, cuerpo, token) {
  try {
    const res = await fetch(url, {
      method: metodo,
      headers: {
        ...(cuerpo ? { 'Content-Type': 'application/json' } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: cuerpo ? JSON.stringify(cuerpo) : undefined,
      signal: AbortSignal.timeout(15000),
    });
    const datos = res.status === 204 ? null : await res.json().catch(() => null);
    return { status: res.status, datos };
  } catch (err) {
    return { status: 0, datos: { error: `sin respuesta (${err.cause?.code || err.message})` } };
  }
}

// Un paso: pide (con el token indicado, o sin token), compara el código y (opcional) una
// condición sobre la respuesta.
async function paso(descripcion, metodo, url, cuerpo, token, esperado, condicion) {
  const r = await pedir(metodo, url, cuerpo, token);
  let problema = null;
  if (r.status !== esperado) {
    problema = `esperaba ${esperado}, respondió ${r.status} ${JSON.stringify(r.datos)?.slice(0, 160)}`;
  } else if (condicion) {
    problema = condicion(r.datos);
  }
  if (problema) {
    fallas++;
    console.log(`  FAIL  ${descripcion}\n        ${metodo} ${url} -> ${problema}`);
  } else {
    ok++;
    console.log(`  OK    ${descripcion} (${r.status})`);
  }
  return r;
}

// Las lecturas de Inventario son locales al nodo: si el que responde es follower puede
// estar un instante atrasado. Se espera un poco antes de dar el valor por malo.
async function esperarStock(productoId, esperado) {
  let actual;
  for (let i = 0; i < 20; i++) {
    const r = await pedir('GET', `${INVENTARIO}/stock?productoIds=${productoId}`);
    actual = r.datos?.[0]?.stock;
    if (actual === esperado) return null;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  return `el stock quedó en ${actual}, se esperaba ${esperado}`;
}

function verificar(descripcion, problema) {
  if (problema) {
    fallas++;
    console.log(`  FAIL  ${descripcion}\n        ${problema}`);
  } else {
    ok++;
    console.log(`  OK    ${descripcion}`);
  }
}

function leerDatos() {
  if (!fs.existsSync(ARCHIVO)) {
    console.error('No existe scripts/.datos-prueba.json: correr antes `node scripts/seed.js`.');
    process.exit(1);
  }
  const { productos } = JSON.parse(fs.readFileSync(ARCHIVO, 'utf8'));
  return Object.fromEntries(productos.map((p) => [p.clave, p]));
}

(async () => {
  const datos = leerDatos();
  const teclado = datos.teclado;
  const baja = datos.baja;
  const compra = (items) => ({ items });

  console.log('\n1. Salud de los servicios');
  await paso('auth-service /health', 'GET', `${AUTH}/health`, null, null, 200, (d) => (d?.status === 'ok' ? null : 'status distinto de ok'));
  await paso('Catálogo /health', 'GET', `${CATALOGO}/health`, null, null, 200, (d) => (d?.status === 'ok' ? null : 'status distinto de ok'));
  for (const nodo of NODOS) {
    await paso(`Inventario ${nodo} /health`, 'GET', `${nodo}/health`, null, null, 200, (d) => (d?.status === 'ok' ? null : 'status distinto de ok'));
  }
  await paso('Ventas /health', 'GET', `${VENTAS}/health`, null, null, 200, (d) => (d?.service === 'ventas-service' ? null : 'service distinto'));

  console.log('\n2. Autenticación (auth-service)');
  const admin = credencialesAdmin();
  const sesion = {};
  for (const [clave, email, password] of [
    ['admin', admin.email, admin.password],
    ...CLIENTES.map((c) => [c.clave, c.email, c.password]),
  ]) {
    try {
      sesion[clave] = await login(pedir, email, password);
      verificar(`Login de ${clave}`, sesion[clave].sub ? null : 'el token no tiene sub');
    } catch (err) {
      verificar(`Login de ${clave}`, err.message);
    }
  }
  const tAdmin = sesion.admin?.token;
  const tCliente1 = sesion.cliente1?.token;
  const tCliente2 = sesion.cliente2?.token;
  await paso('Login con password incorrecta', 'POST', `${AUTH}/auth/login`, { email: CLIENTES[0].email, password: 'no-es-la-password' }, null, 401);

  console.log('\n3. Catálogo: alta, consulta, modificación y baja lógica (ADMIN)');
  const nombre = `Producto smoke test ${Date.now()}`;
  await paso('Crear producto sin token', 'POST', `${CATALOGO}/productos`, { nombre, precio: 500, categoria: 'otro' }, null, 401);
  await paso('Crear producto con un CLIENTE', 'POST', `${CATALOGO}/productos`, { nombre, precio: 500, categoria: 'otro' }, tCliente1, 403);
  const alta = await paso('Crear producto con ADMIN', 'POST', `${CATALOGO}/productos`, { nombre, precio: 500, categoria: 'otro' }, tAdmin, 201, (d) =>
    d?.id && d.activo === true ? null : 'no devolvió id o no quedó activo'
  );
  const nuevoId = alta.datos?.id || ID_INEXISTENTE;
  await paso('Leer producto (público)', 'GET', `${CATALOGO}/productos/${nuevoId}`, null, null, 200, (d) => (d?.nombre === nombre ? null : 'nombre distinto'));
  await paso('Modificar precio', 'PUT', `${CATALOGO}/productos/${nuevoId}`, { precio: 750 }, tAdmin, 200, (d) => (d?.precio === 750 ? null : 'precio no actualizado'));
  await paso('Rechazar stock en Catálogo', 'PUT', `${CATALOGO}/productos/${nuevoId}`, { stock: 5 }, tAdmin, 400);
  await paso('Dar de baja (lógica)', 'DELETE', `${CATALOGO}/productos/${nuevoId}`, null, tAdmin, 204);
  await paso('Sigue existiendo, inactivo', 'GET', `${CATALOGO}/productos/${nuevoId}`, null, null, 200, (d) => (d?.activo === false ? null : 'sigue activo'));

  console.log('\n4. Inventario: disponibilidad y quién puede mover stock');
  const stockInicial = await paso('Consultar stock del teclado (público)', 'GET', `${INVENTARIO}/stock?productoIds=${teclado.id}`, null, null, 200, (d) =>
    Number.isInteger(d?.[0]?.stock) ? null : 'respuesta sin stock'
  );
  const disponible = stockInicial.datos?.[0]?.stock ?? 0;
  await paso('Un CLIENTE no puede descontar stock directo en Inventario', 'POST', `${INVENTARIO}/descuentos`, {
    referencia: `smoke-directo-${Date.now()}`,
    items: [{ productoId: teclado.id, cantidad: 1 }],
  }, tCliente1, 403);
  await paso('Un CLIENTE no puede ajustar stock', 'PUT', `${INVENTARIO}/stock/${teclado.id}`, { cantidad: 999 }, tCliente1, 403);

  console.log('\n5. Ventas: registrar compras (C1 + C2 con la cuenta de servicio)');
  await paso('Comprar sin token', 'POST', `${VENTAS}/compras`, compra([{ productoId: teclado.id, cantidad: 1 }]), null, 401);
  const confirmada = await paso(
    'cliente1 compra 1 teclado',
    'POST',
    `${VENTAS}/compras`,
    compra([{ productoId: teclado.id, cantidad: 1 }]),
    tCliente1,
    201,
    (d) => {
      if (d?.estado !== 'CONFIRMADA' || d.total !== teclado.precio) return `estado ${d?.estado}, total ${d?.total}`;
      return d.usuarioId === sesion.cliente1?.sub ? null : `la compra quedó a nombre de ${d.usuarioId}`;
    }
  );
  const compraId = confirmada.datos?.compraId || ID_INEXISTENTE;
  verificar('El stock bajó 1 unidad', await esperarStock(teclado.id, disponible - 1));
  await paso('Comprar más unidades de las que hay', 'POST', `${VENTAS}/compras`, compra([{ productoId: teclado.id, cantidad: 1000 }]), tCliente1, 409, (d) =>
    Array.isArray(d?.faltantes) && d.faltantes[0]?.productoId === teclado.id ? null : 'sin faltantes'
  );
  await paso('Comprar un producto inexistente', 'POST', `${VENTAS}/compras`, compra([{ productoId: ID_INEXISTENTE, cantidad: 1 }]), tCliente1, 400, (d) =>
    d?.productosInexistentes?.includes(ID_INEXISTENTE) ? null : 'sin productosInexistentes'
  );
  await paso('Comprar el producto dado de baja', 'POST', `${VENTAS}/compras`, compra([{ productoId: baja.id, cantidad: 1 }]), tCliente1, 409, (d) =>
    d?.productosInactivos?.includes(baja.id) ? null : 'sin productosInactivos'
  );
  verificar('Los rechazos no tocaron el stock', await esperarStock(teclado.id, disponible - 1));

  console.log('\n6. Ventas: propiedad de la compra, trazabilidad y cancelación (C3)');
  await paso('cliente1 consulta su compra', 'GET', `${VENTAS}/compras/${compraId}`, null, tCliente1, 200, (d) => {
    const item = d?.items?.[0];
    return item?.precioUnitario === teclado.precio && item.nombreProducto === teclado.nombre ? null : 'sin precio pagado o nombre';
  });
  await paso('cliente2 NO puede consultar la compra de cliente1', 'GET', `${VENTAS}/compras/${compraId}`, null, tCliente2, 403);
  await paso('ADMIN consulta la compra de cliente1', 'GET', `${VENTAS}/compras/${compraId}`, null, tAdmin, 200);
  const movimientos = await pedir('GET', `${INVENTARIO}/movimientos?productoId=${teclado.id}`, null, tAdmin);
  const descuento = Array.isArray(movimientos.datos) ? movimientos.datos.find((m) => m.tipo === 'DESCUENTO' && m.referencia === compraId) : null;
  verificar('Inventario registró el DESCUENTO con referencia = compraId', descuento ? null : `no aparece el movimiento (status ${movimientos.status})`);
  verificar(
    'El DESCUENTO guarda el usuarioId de cliente1 (contexto propagado por Ventas)',
    descuento && descuento.usuarioId === sesion.cliente1?.sub ? null : `usuarioId del movimiento: ${descuento?.usuarioId}`
  );
  await paso('cliente2 NO puede cancelar la compra de cliente1', 'PATCH', `${VENTAS}/compras/${compraId}/cancelar`, null, tCliente2, 403);
  verificar('El rechazo no tocó el stock', await esperarStock(teclado.id, disponible - 1));
  await paso('cliente1 cancela su compra', 'PATCH', `${VENTAS}/compras/${compraId}/cancelar`, null, tCliente1, 200, (d) =>
    d?.estado === 'CANCELADA' ? null : `estado ${d?.estado}`
  );
  verificar('El stock volvió al valor inicial', await esperarStock(teclado.id, disponible));
  await paso('Cancelar otra vez', 'PATCH', `${VENTAS}/compras/${compraId}/cancelar`, null, tCliente1, 409);

  console.log(`\n${ok} OK, ${fallas} FAIL`);
  process.exit(fallas === 0 ? 0 : 1);
})().catch((err) => {
  console.error(`Error ejecutando el smoke test: ${err.message}`);
  process.exit(1);
});
