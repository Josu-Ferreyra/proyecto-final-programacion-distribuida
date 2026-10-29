// Ayudas de autenticación para seed.js y smoke-test.js (TP7). Sin dependencias.
//
// - Lee ADMIN_EMAIL y ADMIN_PASSWORD del entorno o del .env de la raíz (el mismo que usa Compose).
// - Define los dos clientes de prueba. Sus passwords son datos FICTICIOS de laboratorio, no
//   secretos: están documentadas en scripts/README.md para poder repetir las pruebas.
// - login() hace POST /auth/login y devuelve el token y el sub (leído del payload, sin verificar
//   la firma: eso lo hacen los servicios).

const fs = require('node:fs');
const path = require('node:path');

const quitarBarra = (url) => url.replace(/\/+$/, '');
const AUTH = quitarBarra(process.env.AUTH_URL || 'http://localhost:3400');

const CLIENTES = [
  { clave: 'cliente1', email: 'cliente1@tp7.local', password: 'cliente1-de-prueba' },
  { clave: 'cliente2', email: 'cliente2@tp7.local', password: 'cliente2-de-prueba' },
];

function leerEnvRaiz() {
  const archivo = path.join(__dirname, '..', '..', '.env');
  if (!fs.existsSync(archivo)) return {};
  const vars = {};
  for (const linea of fs.readFileSync(archivo, 'utf8').split(/\r?\n/)) {
    if (linea.trim().startsWith('#')) continue;
    const m = linea.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m) vars[m[1]] = m[2].replace(/^(['"])(.*)\1$/, '$2');
  }
  return vars;
}

function credencialesAdmin() {
  const env = { ...leerEnvRaiz(), ...process.env };
  const email = env.ADMIN_EMAIL || 'admin@tp7.local';
  const password = env.ADMIN_PASSWORD;
  if (!password) {
    throw new Error('Falta ADMIN_PASSWORD (definila en el .env de la raíz, el mismo que usa docker compose)');
  }
  return { email, password };
}

function subDe(token) {
  try {
    return JSON.parse(Buffer.from(token.split('.')[1], 'base64url')).sub;
  } catch {
    return null;
  }
}

// pedir: (metodo, url, cuerpo) => { status, datos }
async function login(pedir, email, password) {
  const r = await pedir('POST', `${AUTH}/auth/login`, { email, password });
  if (r.status !== 200 || !r.datos?.accessToken) {
    throw new Error(`Login de ${email} respondió ${r.status}: ${r.datos?.error || JSON.stringify(r.datos)}`);
  }
  return { token: r.datos.accessToken, sub: subDe(r.datos.accessToken) };
}

module.exports = { AUTH, CLIENTES, credencialesAdmin, login, subDe };
