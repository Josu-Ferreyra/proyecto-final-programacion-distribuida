// Toda la configuración sale de variables de entorno: el mismo código corre con
// `npm start` (valores del .env) y en Docker Compose (valores de compose.yml).
// No hay URLs, hosts ni secretos escritos en el código.

function entero(nombre, porDefecto, { min = 1, max = Number.MAX_SAFE_INTEGER } = {}) {
  const valor = process.env[nombre];
  if (valor === undefined || valor === '') return porDefecto;
  const numero = Number(valor);
  if (!Number.isInteger(numero) || numero < min || numero > max) {
    throw new Error(`La variable ${nombre} debe ser un entero entre ${min} y ${max} (valor actual: "${valor}")`);
  }
  return numero;
}

function obligatoria(nombre) {
  const valor = process.env[nombre];
  if (!valor) throw new Error(`Falta la variable de entorno ${nombre} (ver .env.example)`);
  return valor;
}

// HS256 necesita una clave larga: con menos de 32 caracteres se puede adivinar por fuerza bruta.
// Sin valor por defecto: si falta, el servicio no arranca (D9, D16).
function secretoJwt() {
  const valor = obligatoria('JWT_SECRET');
  if (valor.length < 32) {
    throw new Error('JWT_SECRET tiene que tener al menos 32 caracteres (ver .env.example para generar uno)');
  }
  return valor;
}

// Vencimiento del access token: segundos ("900") o con unidad ("30s", "15m", "1h").
// Se valida al arrancar para que un valor mal escrito no termine en un 500 en cada login.
function vencimiento(nombre, porDefecto) {
  const valor = process.env[nombre] || porDefecto;
  if (/^\d+$/.test(valor) && Number(valor) > 0) return Number(valor);
  if (/^\d+[smhd]$/.test(valor) && parseInt(valor, 10) > 0) return valor;
  throw new Error(`La variable ${nombre} debe ser un número de segundos o algo como "30s", "15m" o "1h" (valor actual: "${valor}")`);
}

// Cuentas que se crean al arrancar (D11). Son opcionales: si faltan, el servicio arranca igual y lo
// avisa en el log (services/bootstrap.js).
function cuenta(prefijo, rol) {
  const email = process.env[`${prefijo}_EMAIL`];
  const password = process.env[`${prefijo}_PASSWORD`];
  return Object.freeze({ variable: prefijo, rol, email: email || null, password: password || null });
}

const config = Object.freeze({
  serviceName: process.env.SERVICE_NAME || 'auth-service',
  port: entero('PORT', 3400),
  mongodbUri: obligatoria('MONGODB_URI'),
  mongodbIntentos: entero('MONGODB_CONNECT_RETRIES', 10),
  mongodbEsperaMs: entero('MONGODB_RETRY_MS', 3000),
  logLevel: process.env.LOG_LEVEL || 'info',

  // JWT (D9): HS256, emisor fijo y vencimiento corto (D12: no hay revocación).
  jwtSecret: secretoJwt(),
  jwtIssuer: process.env.JWT_ISSUER || 'auth-service',
  jwtExpiresIn: vencimiento('JWT_EXPIRES_IN', '15m'),

  // Costo de bcrypt: 12 rondas ≈ 250 ms por hash. Menos de 10 es demasiado rápido para un atacante.
  bcryptRounds: entero('BCRYPT_ROUNDS', 12, { min: 10, max: 15 }),

  cuentasIniciales: Object.freeze([cuenta('ADMIN', 'ADMIN'), cuenta('VENTAS_SERVICE', 'SERVICIO')]),
});

module.exports = config;
