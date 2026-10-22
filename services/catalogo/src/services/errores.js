// Error de negocio o de validación con su código HTTP. Lo lanza la capa de servicios
// y lo traduce el manejador de errores de app.js al formato { error, servicio }.
class ErrorCatalogo extends Error {
  constructor(status, mensaje) {
    super(mensaje);
    this.name = 'ErrorCatalogo';
    this.status = status;
  }
}

const solicitudInvalida = (mensaje) => new ErrorCatalogo(400, mensaje);
const noEncontrado = (mensaje) => new ErrorCatalogo(404, mensaje);
const conflicto = (mensaje) => new ErrorCatalogo(409, mensaje);

module.exports = { ErrorCatalogo, solicitudInvalida, noEncontrado, conflicto };
