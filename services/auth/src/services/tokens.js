const jwt = require('jsonwebtoken');
const config = require('../config/env');

// Emisión del access token (D9). Claims: sub (id del usuario), role, iss, iat y exp. Nada más:
// ni email, ni password, ni hash (TP7 §8.3). scripts/token.js firma exactamente lo mismo.
function emitirToken(usuario) {
  const accessToken = jwt.sign({ role: usuario.rol }, config.jwtSecret, {
    algorithm: 'HS256',
    subject: usuario.id,
    issuer: config.jwtIssuer,
    expiresIn: config.jwtExpiresIn,
  });
  const { exp, iat } = jwt.decode(accessToken);
  return { accessToken, tokenType: 'Bearer', expiresIn: exp - iat };
}

module.exports = { emitirToken };
