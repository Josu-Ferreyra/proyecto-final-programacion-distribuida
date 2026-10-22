const config = require('../config/env');
const { crearCliente } = require('./httpClient');

// Cliente de Inventario: contratos C2 y C3 (docs/06-comunicaciones.md §6.2).
//   C2  POST /descuentos { referencia, items } -> 201 descontado · 200 ya descontado
//                                                 (idempotente) · 409 { faltantes }
//   C3  DELETE /descuentos/:referencia         -> 204 reintegrado · 404 no había descuento
//
// La URL es la del servicio (alias inventario-service en Compose, D1): Ventas no sabe
// que Inventario es un cluster Raft ni a qué nodo le toca. Un 421 o un 503 son, para
// Ventas, "Inventario no disponible".
const http = crearCliente({ nombre: 'inventario-service', baseUrl: config.inventarioUrl, timeoutMs: config.httpTimeoutMs });

async function descontar(referencia, items) {
  return http.post('/descuentos', { referencia, items });
}

async function reintegrar(referencia) {
  return http.delete(`/descuentos/${encodeURIComponent(referencia)}`);
}

module.exports = { descontar, reintegrar };
