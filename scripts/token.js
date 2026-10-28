// Genera access tokens JWT de prueba, firmados igual que los emite auth-service (D9 de
// docs/14-modelo-seguridad.md): HS256, iss "auth-service", claims sub, role, iat y exp.
//
// Es una HERRAMIENTA DE DESARROLLO Y PRUEBAS, no un endpoint: necesita conocer JWT_SECRET, así
// que no es una forma de obtener un token sin credenciales. Sirve para probar la protección de
// cada servicio sin depender de auth-service, y para las pruebas E, F y G del TP7 (token
// modificado, firmado con otro secreto o vencido).
//
//   node scripts/token.js --rol ADMIN                      token válido por 15 minutos
//   node scripts/token.js --rol CLIENTE --sub cliente-1    otro usuario
//   node scripts/token.js --rol SERVICIO --minutos 1       vencimiento corto
//   node scripts/token.js --rol ADMIN --vencido            venció hace 1 minuto (prueba G)
//   node scripts/token.js --rol ADMIN --secreto-falso      firmado con otra clave (prueba F)
//   node scripts/token.js --rol ADMIN --decodificar        muestra el payload, no el token
//
// Imprime solo el token, para usarlo así:  TOKEN=$(node scripts/token.js --rol ADMIN)
// Lee JWT_SECRET (y JWT_ISSUER) del entorno o, si no están, del .env de la raíz.
// Sin dependencias: no hace falta npm install en la raíz.

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const ROLES = ['CLIENTE', 'ADMIN', 'SERVICIO'];

function leerEnvRaiz() {
  const archivo = path.join(__dirname, '..', '.env');
  if (!fs.existsSync(archivo)) return {};
  const vars = {};
  for (const linea of fs.readFileSync(archivo, 'utf8').split(/\r?\n/)) {
    const m = linea.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m && !linea.trim().startsWith('#')) vars[m[1]] = m[2].replace(/^(['"])(.*)\1$/, '$2');
  }
  return vars;
}

function opciones(argv) {
  const op = { rol: null, sub: null, minutos: 15, vencido: false, secretoFalso: false, decodificar: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--rol') op.rol = (argv[++i] || '').toUpperCase();
    else if (a === '--sub') op.sub = argv[++i];
    else if (a === '--minutos') op.minutos = Number(argv[++i]);
    else if (a === '--vencido') op.vencido = true;
    else if (a === '--secreto-falso') op.secretoFalso = true;
    else if (a === '--decodificar') op.decodificar = true;
    else fallar(`Opción desconocida: ${a}`);
  }
  if (!ROLES.includes(op.rol)) fallar(`--rol es obligatorio y tiene que ser uno de: ${ROLES.join(', ')}`);
  if (!Number.isFinite(op.minutos) || op.minutos <= 0) fallar('--minutos tiene que ser un número mayor a 0');
  return op;
}

function fallar(mensaje) {
  console.error(`token.js: ${mensaje}`);
  process.exit(1);
}

const b64url = (obj) => Buffer.from(JSON.stringify(obj)).toString('base64url');

function firmar(payload, secreto) {
  const cuerpo = `${b64url({ alg: 'HS256', typ: 'JWT' })}.${b64url(payload)}`;
  const firma = crypto.createHmac('sha256', secreto).update(cuerpo).digest('base64url');
  return `${cuerpo}.${firma}`;
}

function main() {
  const op = opciones(process.argv.slice(2));
  const env = { ...leerEnvRaiz(), ...process.env };

  let secreto = env.JWT_SECRET;
  if (!secreto) fallar('falta JWT_SECRET (definilo en el entorno o en el .env de la raíz; ver .env.example)');
  if (op.secretoFalso) secreto = crypto.randomBytes(48).toString('base64');

  const ahora = Math.floor(Date.now() / 1000);
  const iat = op.vencido ? ahora - 16 * 60 : ahora;
  const exp = op.vencido ? ahora - 60 : ahora + Math.round(op.minutos * 60);
  const payload = {
    sub: op.sub || `prueba-${op.rol.toLowerCase()}`,
    role: op.rol,
    iss: env.JWT_ISSUER || 'auth-service',
    iat,
    exp,
  };

  if (op.decodificar) {
    console.log(JSON.stringify(payload, null, 2));
    return;
  }
  process.stdout.write(`${firmar(payload, secreto)}\n`);
}

main();
