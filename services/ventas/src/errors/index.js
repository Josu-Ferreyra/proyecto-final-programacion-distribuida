// Errores tipados de Ventas. Separan los tres casos que pide la sección 15.2 del TP6,
// para que la capa de negocio decida con información y no con un error genérico:
//
//   ErrorNegocio            -> lo que Ventas le responde a SU cliente (código + detalle)
//   DependenciaNoDisponible -> no hubo respuesta válida del otro servicio
//                              (timeout, DNS o conexión rechazada)
//   RespuestaRemota         -> hubo respuesta, pero no exitosa (404, 409, 5xx, ...)

class ErrorNegocio extends Error {
  constructor(status, mensaje, detalle = {}) {
    super(mensaje);
    this.name = 'ErrorNegocio';
    this.status = status;
    this.detalle = detalle;
  }
}

class DependenciaNoDisponible extends Error {
  // causa: 'timeout' | 'dns' | 'conexion'
  constructor(dependencia, causa, operacion) {
    super(`${dependencia} no disponible (${causa})`);
    this.name = 'DependenciaNoDisponible';
    this.dependencia = dependencia;
    this.causa = causa;
    this.operacion = operacion;
  }
}

class RespuestaRemota extends Error {
  constructor(dependencia, status, cuerpo, operacion) {
    super(`${dependencia} respondió ${status}`);
    this.name = 'RespuestaRemota';
    this.dependencia = dependencia;
    this.status = status;
    this.cuerpo = cuerpo;
    this.operacion = operacion;
  }
}

module.exports = { ErrorNegocio, DependenciaNoDisponible, RespuestaRemota };
