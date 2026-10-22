// Mocks de Catálogo (C1) e Inventario (C2, C3) para desarrollar y probar Ventas sin
// levantar los servicios reales. Solo para desarrollo: está fuera de src/ y el
// .dockerignore lo deja afuera de la imagen. No usa dependencias (node:http).
//
// Uso (desde services/ventas):
//   npm run mock                          -> escenario "ok"
//   MOCK_ESCENARIO=lento npm run mock     -> (PowerShell: $env:MOCK_ESCENARIO='lento'; npm run mock)
//
// Escenarios:
//   ok        C1 200 con los productos · C2 descuenta de verdad (201, 200 si la referencia
//             se repite, 409 { faltantes } si no alcanza) · C3 204, o 404 si no había descuento
//   inactivo  igual que ok, pero el segundo producto viene con activo: false
//   sin-stock C2 responde siempre 409 { faltantes }
//   lento     C2 tarda 5 s (más que el timeout de Ventas) y DESPUÉS aplica el descuento
//   caido     C1, C2 y C3 responden 503
//
// Cuando estén los servicios reales se apaga el mock y se cambia solo el .env.

const http = require('node:http');

const ESCENARIO = process.env.MOCK_ESCENARIO || 'ok';
const PUERTO_CATALOGO = Number(process.env.MOCK_CATALOGO_PORT) || 3100;
const PUERTO_INVENTARIO = Number(process.env.MOCK_INVENTARIO_PORT) || 3201;
const ESCENARIOS = ['ok', 'inactivo', 'sin-stock', 'lento', 'caido'];

if (!ESCENARIOS.includes(ESCENARIO)) {
  console.error(`MOCK_ESCENARIO inválido: "${ESCENARIO}". Valores: ${ESCENARIOS.join(', ')}`);
  process.exit(1);
}

// Ids fijos para poder copiarlos en las pruebas.
const PRODUCTOS = [
  { id: '6ad000000000000000000001', nombre: 'Teclado mecánico (mock)', precio: 25000, categoria: 'periferico', activo: true },
  { id: '6ad000000000000000000002', nombre: 'Mouse inalámbrico (mock)', precio: 12000, categoria: 'periferico', activo: ESCENARIO !== 'inactivo' },
];
const stock = new Map(PRODUCTOS.map((p) => [p.id, 10]));
const descuentos = new Map(); // referencia -> { items, reintegrado }

function log(servicio, req, status) {
  console.log(`${new Date().toISOString().slice(11, 23)} [mock-${servicio}] ${req.method} ${req.url} -> ${status}`);
}

function responder(servicio, req, res, status, cuerpo) {
  log(servicio, req, status);
  if (cuerpo === undefined) {
    res.writeHead(status).end();
    return;
  }
  res.writeHead(status, { 'Content-Type': 'application/json' }).end(JSON.stringify(cuerpo));
}

function leerCuerpo(req) {
  return new Promise((resolve) => {
    let datos = '';
    req.on('data', (c) => (datos += c));
    req.on('end', () => {
      try {
        resolve(datos ? JSON.parse(datos) : {});
      } catch {
        resolve({});
      }
    });
  });
}

const noDisponible = (servicio) => ({ error: `${servicio} no disponible (mock: escenario caido)`, servicio });

// ---------------------------------------------------------------- Catálogo (C1)

const catalogo = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://mock');
  if (url.pathname === '/health') return responder('catalogo', req, res, 200, { service: 'catalogo-service', status: 'ok' });
  if (ESCENARIO === 'caido') return responder('catalogo', req, res, 503, noDisponible('catalogo-service'));

  if (req.method === 'GET' && url.pathname === '/productos') {
    const ids = (url.searchParams.get('ids') || '').split(',').filter(Boolean);
    return responder('catalogo', req, res, 200, PRODUCTOS.filter((p) => ids.includes(p.id)));
  }
  return responder('catalogo', req, res, 404, { error: 'Ruta no encontrada', servicio: 'catalogo-service' });
});

// ---------------------------------------------------------------- Inventario (C2, C3)

function aplicarDescuento(referencia, items) {
  const previo = descuentos.get(referencia);
  if (previo) return { status: 200, cuerpo: { referencia, items: previo.items } };

  const faltantes = items
    .map((i) => ({ productoId: i.productoId, solicitado: i.cantidad, disponible: stock.get(i.productoId) ?? 0 }))
    .filter((f) => f.disponible < f.solicitado);
  if (faltantes.length) return { status: 409, cuerpo: { error: 'Stock insuficiente', servicio: 'inventario-service', faltantes } };

  items.forEach((i) => stock.set(i.productoId, stock.get(i.productoId) - i.cantidad));
  descuentos.set(referencia, { items, reintegrado: false });
  return { status: 201, cuerpo: { referencia, items } };
}

const inventario = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://mock');
  if (url.pathname === '/health') return responder('inventario', req, res, 200, { service: 'inventario-service', status: 'ok' });
  if (ESCENARIO === 'caido') return responder('inventario', req, res, 503, noDisponible('inventario-service'));

  if (req.method === 'POST' && url.pathname === '/descuentos') {
    const { referencia, items = [] } = await leerCuerpo(req);
    if (ESCENARIO === 'sin-stock') {
      const faltantes = items.map((i) => ({ productoId: i.productoId, solicitado: i.cantidad, disponible: 0 }));
      return responder('inventario', req, res, 409, { error: 'Stock insuficiente', servicio: 'inventario-service', faltantes });
    }
    if (ESCENARIO === 'lento') {
      // Ventas corta a los 3 s; el descuento se aplica igual a los 5 s (el caso que
      // obliga a compensar).
      await new Promise((r) => setTimeout(r, 5000));
      const { status, cuerpo } = aplicarDescuento(referencia, items);
      log('inventario', req, `${status} (tarde: Ventas ya había cortado)`);
      if (!res.destroyed) res.writeHead(status, { 'Content-Type': 'application/json' }).end(JSON.stringify(cuerpo));
      return;
    }
    const { status, cuerpo } = aplicarDescuento(referencia, items);
    return responder('inventario', req, res, status, cuerpo);
  }

  const reintegro = url.pathname.match(/^\/descuentos\/([^/]+)$/);
  if (req.method === 'DELETE' && reintegro) {
    const referencia = decodeURIComponent(reintegro[1]);
    const descuento = descuentos.get(referencia);
    if (!descuento) return responder('inventario', req, res, 404, { error: `No hay un descuento con la referencia ${referencia}`, servicio: 'inventario-service' });
    if (!descuento.reintegrado) {
      descuento.items.forEach((i) => stock.set(i.productoId, stock.get(i.productoId) + i.cantidad));
      descuento.reintegrado = true;
    }
    return responder('inventario', req, res, 204);
  }

  if (req.method === 'GET' && url.pathname === '/stock') {
    return responder('inventario', req, res, 200, [...stock].map(([productoId, s]) => ({ productoId, stock: s })));
  }
  return responder('inventario', req, res, 404, { error: 'Ruta no encontrada', servicio: 'inventario-service' });
});

catalogo.listen(PUERTO_CATALOGO, () => console.log(`Mock de Catálogo en http://localhost:${PUERTO_CATALOGO}`));
inventario.listen(PUERTO_INVENTARIO, () => console.log(`Mock de Inventario en http://localhost:${PUERTO_INVENTARIO}`));
console.log(`Escenario: ${ESCENARIO}`);
console.table(PRODUCTOS.map((p) => ({ id: p.id, nombre: p.nombre, precio: p.precio, activo: p.activo, stock: stock.get(p.id) })));
