const config = require('../config/env');
const authClient = require('./authClient');
const { crearCliente } = require('./httpClient');
const { RespuestaRemota } = require('../errors');

// Cliente de Inventario: contratos C2 y C3 (docs/06-comunicaciones.md §6.2).
//   C2  POST /descuentos { referencia, items, usuarioId } -> 201 descontado · 200 ya descontado
//                                                            (idempotente) · 409 { faltantes }
//   C3  DELETE /descuentos/:referencia                    -> 204 reintegrado · 404 no había descuento
//
// La URL es la del servicio (alias inventario-service en Compose, D1): Ventas no sabe
// que Inventario es un cluster Raft ni a qué nodo le toca. Un 421 o un 503 son, para
// Ventas, "Inventario no disponible".
//
// TP7 (D13): las dos llamadas van con el token de la cuenta técnica de Ventas (rol SERVICIO),
// nunca con el del cliente. Para quién fue la compra viaja como usuarioId en el body de C2, e
// Inventario lo guarda en el descuento y en los movimientos.
const http = crearCliente({ nombre: 'inventario-service', baseUrl: config.inventarioUrl, timeoutMs: config.httpTimeoutMs });

// Si Inventario responde 401, el token de servicio pudo haber vencido entre la caché y la
// llamada: se pide uno nuevo y se reintenta UNA sola vez. Es seguro porque C2 es idempotente
// por referencia y C3 también.
async function conTokenDeServicio(llamar) {
  const token = await authClient.tokenDeServicio();
  try {
    return await llamar({ Authorization: `Bearer ${token}` });
  } catch (err) {
    if (!(err instanceof RespuestaRemota && err.status === 401)) throw err;
    authClient.invalidar();
    const nuevo = await authClient.tokenDeServicio();
    return llamar({ Authorization: `Bearer ${nuevo}` });
  }
}

async function descontar(referencia, items, usuarioId) {
  return conTokenDeServicio((headers) => http.post('/descuentos', { referencia, items, usuarioId }, headers));
}

async function reintegrar(referencia) {
  return conTokenDeServicio((headers) => http.delete(`/descuentos/${encodeURIComponent(referencia)}`, headers));
}

module.exports = { descontar, reintegrar };
