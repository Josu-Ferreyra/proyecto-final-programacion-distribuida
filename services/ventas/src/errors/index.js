// Error que Ventas responde a su cliente, con su código HTTP. Lo lanza la capa de
// servicios y lo traduce el manejador de errores de app.js al formato
// { error, servicio, ...detalle }.
class ErrorNegocio extends Error {
  constructor(status, mensaje, detalle = {}) {
    super(mensaje);
    this.name = 'ErrorNegocio';
    this.status = status;
    this.detalle = detalle;
  }
}

module.exports = { ErrorNegocio };
