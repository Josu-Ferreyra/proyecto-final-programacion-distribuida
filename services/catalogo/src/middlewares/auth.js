// Autenticación y autorización con JWT (TP7 §9 y §11, decisiones D9 y D14 de
// docs/14-modelo-seguridad.md).
//
// Copia de la versión de referencia de Inventario (no se comparte código entre servicios). La
// verificación es local: no consulta auth-service ni ninguna base de usuarios (TP7 §12), así que los
// tokens ya emitidos siguen validándose aunque auth-service esté caído (D15).
//
//   autenticar          401 si no hay una identidad válida; deja req.usuario = { id, rol }
//   requerirRol(...)    403 si la identidad es válida pero el rol no alcanza (va después de autenticar)
//
// El token nunca se loguea ni se devuelve.

const jwt = require('jsonwebtoken');

function crearAuth({ secret, issuer, serviceName, logger }) {
  const rechazar = (res, req, motivo) => {
    logger.warn('Request rechazada por autenticación', { operacion: `${req.method} ${req.path}`, status: 401, motivo });
    res.set('WWW-Authenticate', 'Bearer');
    return res.status(401).json({ error: motivo, servicio: serviceName });
  };

  function autenticar(req, res, next) {
    const [esquema, token] = (req.get('Authorization') || '').split(' ');
    if (esquema !== 'Bearer' || !token) return rechazar(res, req, 'Token ausente');
    try {
      // algorithms fijo: rechaza alg "none" y cualquier algoritmo distinto de HS256 (TP7 §8.1).
      const p = jwt.verify(token, secret, { algorithms: ['HS256'], issuer });
      if (!p.sub || !p.role || !p.exp) return rechazar(res, req, 'Token inválido');
      req.usuario = { id: p.sub, rol: p.role };
      return next();
    } catch (err) {
      return rechazar(res, req, err.name === 'TokenExpiredError' ? 'Token vencido' : 'Token inválido');
    }
  }

  const requerirRol = (...roles) => (req, res, next) => {
    if (roles.includes(req.usuario.rol)) return next();
    logger.warn('Request rechazada por autorización', {
      operacion: `${req.method} ${req.path}`,
      status: 403,
      usuarioId: req.usuario.id,
      rol: req.usuario.rol,
      rolesPermitidos: roles,
    });
    return res.status(403).json({ error: 'Permisos insuficientes', servicio: serviceName });
  };

  return { autenticar, requerirRol };
}

module.exports = { crearAuth };
