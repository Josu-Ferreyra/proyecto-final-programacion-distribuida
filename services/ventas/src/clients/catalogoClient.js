const config = require('../config/env');
const { crearCliente } = require('./httpClient');

// Cliente de Catálogo: contrato C1 (docs/06-comunicaciones.md §6.2).
//   GET /productos?ids=a,b,c -> 200 [{ id, nombre, precio, activo, ... }]
// Los ids inexistentes o mal formados simplemente no aparecen en la respuesta.
const http = crearCliente({ nombre: 'catalogo-service', baseUrl: config.catalogoUrl, timeoutMs: config.httpTimeoutMs });

async function obtenerProductos(ids) {
  const { datos } = await http.get(`/productos?ids=${ids.map(encodeURIComponent).join(',')}`);
  return datos;
}

module.exports = { obtenerProductos };
