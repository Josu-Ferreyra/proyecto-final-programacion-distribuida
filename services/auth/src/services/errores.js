// Error de negocio o de validación con su código HTTP. Lo lanza la capa de servicios
// y lo traduce el manejador de errores de app.js al formato { error, servicio }.
class ErrorAuth extends Error {
  constructor(status, mensaje) {
    super(mensaje);
    this.name = 'ErrorAuth';
    this.status = status;
  }
}

const solicitudInvalida = (mensaje) => new ErrorAuth(400, mensaje);
const noAutorizado = (mensaje) => new ErrorAuth(401, mensaje);
const prohibido = (mensaje) => new ErrorAuth(403, mensaje);
const noEncontrado = (mensaje) => new ErrorAuth(404, mensaje);
const conflicto = (mensaje) => new ErrorAuth(409, mensaje);

module.exports = { ErrorAuth, solicitudInvalida, noAutorizado, prohibido, noEncontrado, conflicto };
