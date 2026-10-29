// Datos de prueba reproducibles (entregable 13 del TP6, con autenticación del TP7).
//
// Carga los productos en Catálogo y su stock en Inventario usando SOLO las APIs públicas:
// nunca escribe en una base. Cada servicio es dueño de sus datos, así que un script que
// inserta directo en Mongo dejaría de ser válido (observación 10 de docs/01-inventario.md).
//
// TP7: las escrituras de Catálogo e Inventario piden rol ADMIN, así que el seed primero hace
// login como el ADMIN que crea auth-service al arrancar (ADMIN_EMAIL / ADMIN_PASSWORD del .env
// de la raíz). Además registra los dos clientes de prueba que usa smoke-test.js.
//
// Es idempotente: correrlo dos veces deja el mismo estado. Si un producto ya existe lo
// reutiliza y le vuelve a poner el precio y la categoría conocidos, el stock siempre se
// vuelve a fijar en el valor de la tabla, y si un cliente ya existe lo reutiliza.
//
// Uso (Node 18+, sin dependencias), desde la raíz del repositorio:
//   node scripts/seed.js
// Variables opcionales (por defecto, los puertos publicados por Compose, que son también
// los de la ejecución local):
//   CATALOGO_URL=http://localhost:3100   INVENTARIO_URL=http://localhost:3201
//   AUTH_URL=http://localhost:3400       ADMIN_EMAIL / ADMIN_PASSWORD (si no, los del .env)
//
// Escribe los ids generados en scripts/.datos-prueba.json (lo usa smoke-test.js).

const fs = require('node:fs');
const path = require('node:path');
const { AUTH, CLIENTES, credencialesAdmin, login } = require('./lib/auth-pruebas');

const CATALOGO = (process.env.CATALOGO_URL || 'http://localhost:3100').replace(/\/+$/, '');
const INVENTARIO = (process.env.INVENTARIO_URL || 'http://localhost:3201').replace(/\/+$/, '');
const ARCHIVO = path.join(__dirname, '.datos-prueba.json');

// Los mismos 3 productos del seed del TP4 (app-base/scripts/seed.js), más uno que se da de
// baja para poder probar que Ventas no vende productos inactivos (409).
const PRODUCTOS = [
  { clave: 'teclado', nombre: 'Teclado mecánico', precio: 25000, categoria: 'periferico', stock: 10 },
  { clave: 'mouse', nombre: 'Mouse inalámbrico', precio: 12000, categoria: 'periferico', stock: 10 },
  { clave: 'monitor', nombre: 'Monitor 24"', precio: 90000, categoria: 'monitor', stock: 10 },
  { clave: 'baja', nombre: 'Producto dado de baja', precio: 1000, categoria: 'otro', stock: 5, baja: true },
];

const ESPERA_MAXIMA_MS = 90000;
let tokenAdmin = null;

async function pedir(metodo, url, cuerpo, token) {
  let res;
  try {
    res = await fetch(url, {
      method: metodo,
      headers: {
        ...(cuerpo ? { 'Content-Type': 'application/json' } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: cuerpo ? JSON.stringify(cuerpo) : undefined,
      signal: AbortSignal.timeout(10000),
    });
  } catch (err) {
    throw new Error(`${metodo} ${url}: sin respuesta (${err.cause?.code || err.message})`);
  }
  const datos = res.status === 204 ? null : await res.json().catch(() => null);
  return { status: res.status, datos };
}

// Las escrituras van con el token del ADMIN.
async function exigir(metodo, url, cuerpo, esperados) {
  const r = await pedir(metodo, url, cuerpo, tokenAdmin);
  if (!esperados.includes(r.status)) {
    throw new Error(`${metodo} ${url} respondió ${r.status}: ${r.datos?.error || JSON.stringify(r.datos)}`);
  }
  return r.datos;
}

// Después de "docker compose up" los servicios pueden tardar unos segundos (y Inventario
// necesita elegir Leader). Se espera a que respondan en lugar de fallar enseguida.
async function esperarServicios() {
  const limite = Date.now() + ESPERA_MAXIMA_MS;
  const servicios = [
    ['auth-service', `${AUTH}/health`],
    ['Catálogo', `${CATALOGO}/health`],
    ['Inventario', `${INVENTARIO}/health`],
  ];
  for (const [nombre, url] of servicios) {
    for (;;) {
      const r = await pedir('GET', url).catch(() => null);
      if (r?.status === 200) break;
      if (Date.now() > limite) throw new Error(`${nombre} no respondió en ${ESPERA_MAXIMA_MS / 1000} s (${url})`);
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
  }
}

// Fija el stock (ADMIN). Si Inventario está en elección de Leader responde 503: se reintenta
// unas veces (PUT es idempotente).
async function fijarStock(productoId, cantidad) {
  for (let intento = 1; ; intento++) {
    const r = await pedir('PUT', `${INVENTARIO}/stock/${productoId}`, { cantidad }, tokenAdmin);
    if (r.status === 200) return;
    if (r.status !== 503 || intento === 10) {
      throw new Error(`PUT /stock/${productoId} respondió ${r.status}: ${r.datos?.error || JSON.stringify(r.datos)}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }
}

async function cargar(p) {
  const encontrados = await exigir('GET', `${CATALOGO}/productos?nombreContiene=${encodeURIComponent(p.nombre)}`, null, [200]);
  let producto = encontrados.find((e) => e.nombre === p.nombre);

  if (!producto) {
    producto = await exigir('POST', `${CATALOGO}/productos`, { nombre: p.nombre, precio: p.precio, categoria: p.categoria }, [201]);
  } else if (producto.precio !== p.precio || producto.categoria !== p.categoria) {
    producto = await exigir('PUT', `${CATALOGO}/productos/${producto.id}`, { precio: p.precio, categoria: p.categoria }, [200]);
  }

  if (!p.baja && producto.activo === false) {
    throw new Error(
      `"${p.nombre}" está dado de baja en Catálogo y no hay forma de reactivarlo por la API. ` +
        'Reiniciar el laboratorio: docker compose down -v && docker compose up --build -d'
    );
  }

  // El stock se fija ANTES de la baja: C4 rechaza dar de alta el stock de un producto
  // inactivo. En una segunda corrida ya tiene stock, así que es un ajuste y no consulta C4.
  await fijarStock(producto.id, p.stock);
  if (p.baja) await exigir('DELETE', `${CATALOGO}/productos/${producto.id}`, null, [204]);

  return { clave: p.clave, id: producto.id, nombre: p.nombre, precio: p.precio, stock: p.stock, activo: !p.baja };
}

// Registra el cliente (201) o lo reutiliza si ya existe (409), y confirma que puede hacer login.
async function cargarCliente(c) {
  const r = await pedir('POST', `${AUTH}/auth/register`, { email: c.email, password: c.password });
  if (![201, 409].includes(r.status)) {
    throw new Error(`POST /auth/register de ${c.email} respondió ${r.status}: ${r.datos?.error || JSON.stringify(r.datos)}`);
  }
  const { sub } = await login(pedir, c.email, c.password);
  return { clave: c.clave, email: c.email, id: sub, rol: 'CLIENTE', nuevo: r.status === 201 };
}

(async () => {
  console.log(`auth-service: ${AUTH} · Catálogo: ${CATALOGO} · Inventario: ${INVENTARIO}`);
  await esperarServicios();

  const admin = credencialesAdmin();
  tokenAdmin = (await login(pedir, admin.email, admin.password)).token;
  console.log(`Login como ADMIN (${admin.email}): OK`);

  const productos = [];
  for (const p of PRODUCTOS) productos.push(await cargar(p));
  console.table(productos);

  const clientes = [];
  for (const c of CLIENTES) clientes.push(await cargarCliente(c));
  console.table(clientes);

  fs.writeFileSync(ARCHIVO, `${JSON.stringify({ generado: new Date().toISOString(), productos, clientes }, null, 2)}\n`);
  console.log(`Ids guardados en ${path.relative(process.cwd(), ARCHIVO)}`);
})().catch((err) => {
  console.error(`Error cargando los datos de prueba: ${err.message}`);
  process.exit(1);
});
