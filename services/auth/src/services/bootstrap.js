const config = require('../config/env');
const logger = require('../config/logger');
const { Usuario } = require('../models/usuario.model');
const { crear } = require('./usuarios.service');
const { ErrorAuth } = require('./errores');

// Cuentas que no se pueden crear por la API (D11): el primer ADMIN (register siempre crea CLIENTE)
// y la cuenta técnica de Ventas (rol SERVICIO, D13). Salen de variables de entorno.
//
// Es idempotente: si la cuenta ya existe no se toca, así reiniciar el servicio no cambia la
// password ni el estado de nadie. Si faltan las variables, se avisa y se sigue.
async function crearCuentasIniciales() {
  for (const { variable, rol, email, password } of config.cuentasIniciales) {
    if (!email || !password) {
      logger.warn(`Cuenta ${rol} no configurada: faltan ${variable}_EMAIL o ${variable}_PASSWORD`, { operacion: 'bootstrap', rol });
      continue;
    }

    const existente = await Usuario.findOne({ email: email.trim().toLowerCase() });
    if (existente) {
      if (existente.rol !== rol) {
        logger.warn(`La cuenta de ${variable}_EMAIL ya existe con otro rol: no se modifica`, {
          operacion: 'bootstrap', usuarioId: existente.id, rol: existente.rol, rolEsperado: rol,
        });
      } else {
        logger.info(`Cuenta ${rol} ya existente: no se modifica`, { operacion: 'bootstrap', usuarioId: existente.id, rol });
      }
      continue;
    }

    try {
      const usuario = await crear({ email, password, rol });
      logger.info(`Cuenta ${rol} creada`, { operacion: 'bootstrap', usuarioId: usuario.id, rol });
    } catch (err) {
      // Una password de arranque inválida es un error de configuración: mejor no arrancar que
      // quedar sin administrador sin que nadie se entere.
      if (err instanceof ErrorAuth && err.status === 400) {
        throw new Error(`${variable}_EMAIL o ${variable}_PASSWORD inválidos: ${err.message}`);
      }
      if (err instanceof ErrorAuth && err.status === 409) continue; // otra instancia la creó recién
      throw err;
    }
  }
}

module.exports = { crearCuentasIniciales };
