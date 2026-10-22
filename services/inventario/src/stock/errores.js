// Error con su código HTTP. Lo lanza la capa de servicios (o un cliente HTTP) y lo
// traduce el manejador de errores de app.js al formato { error, servicio, ...extra }.
class ErrorInventario extends Error {
  constructor(status, mensaje, extra = {}) {
    super(mensaje);
    this.name = 'ErrorInventario';
    this.status = status;
    this.extra = extra;
  }
}

const solicitudInvalida = (mensaje) => new ErrorInventario(400, mensaje);
const noEncontrado = (mensaje) => new ErrorInventario(404, mensaje);
const conflicto = (mensaje, extra) => new ErrorInventario(409, mensaje, extra);
const noDisponible = (mensaje, extra) => new ErrorInventario(503, mensaje, extra);

module.exports = { ErrorInventario, solicitudInvalida, noEncontrado, conflicto, noDisponible };
