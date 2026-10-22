#!/usr/bin/env node
// Revisa que el repositorio cumpla lo que pide la sección 21 del TP6 (entrega), sin
// necesidad de Docker. Es una lista de control automática para correr ANTES de crear el tag:
//
//   node scripts/verificar-entrega.js
//
// Termina con código 1 si falla algún control obligatorio. Los avisos (⚠️) no fallan, pero
// hay que mirarlos.

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const RAIZ = path.join(__dirname, '..');
const SERVICIOS = ['catalogo', 'inventario', 'ventas'];
let fallas = 0;
let avisos = 0;

const leer = (rel) => {
  try {
    return fs.readFileSync(path.join(RAIZ, rel), 'utf8');
  } catch {
    return null;
  }
};
const existe = (rel) => fs.existsSync(path.join(RAIZ, rel));
const git = (args) => spawnSync('git', args, { cwd: RAIZ, encoding: 'utf8' }).stdout?.trim() ?? '';

function control(grupo, descripcion, ok, detalle = '') {
  if (!ok) fallas++;
  console.log(`${ok ? '✅' : '❌'} [${grupo}] ${descripcion}${!ok && detalle ? `\n     ${detalle}` : ''}`);
}
function aviso(grupo, descripcion, hayProblema, detalle = '') {
  if (!hayProblema) return;
  avisos++;
  console.log(`⚠️  [${grupo}] ${descripcion}${detalle ? `\n     ${detalle}` : ''}`);
}

const archivos = git(['ls-files']).split('\n').filter(Boolean);

// ---------------------------------------------------------------- 4, 5, 7: servicios
for (const s of SERVICIOS) {
  const d = `services/${s}`;
  for (const f of ['package.json', 'package-lock.json', 'Dockerfile', '.dockerignore', '.env.example', 'README.md']) {
    control('servicio', `${d}/${f} existe y está versionado`, archivos.includes(`${d}/${f}`));
  }
  const di = leer(`${d}/.dockerignore`) || '';
  control('servicio', `${d}/.dockerignore excluye node_modules y .env`, /node_modules/.test(di) && /^\.env$/m.test(di));
  const df = leer(`${d}/Dockerfile`) || '';
  control('servicio', `${d}/Dockerfile usa npm ci, EXPOSE y CMD`, /npm ci/.test(df) && /EXPOSE/.test(df) && /CMD/.test(df));
  const pkg = JSON.parse(leer(`${d}/package.json`) || '{}');
  control('servicio', `${d}/package.json tiene script "start"`, !!pkg.scripts?.start);
  const deps = Object.keys(pkg.dependencies || {}).concat(Object.keys(pkg.devDependencies || {}));
  control('servicio', `${d} no instala Docker/Compose como dependencia npm`, !deps.some((x) => /docker/i.test(x)));
  const src = archivos.filter((f) => f.startsWith(`${d}/src/`) && f.endsWith('.js'));
  const duros = src.filter((f) => /localhost|127\.0\.0\.1|mongodb:\/\/|redis:\/\/|https?:\/\/[a-z0-9-]+:\d{4}/i.test(leer(f).replace(/\/\/.*$/gm, '')));
  control('config', `${d}/src no tiene hosts, puertos ni URLs de bases escritos`, duros.length === 0, duros.join(', '));
}
control('docs', 'Swagger: cada servicio publica /api-docs',
  SERVICIOS.every((s) => /api-docs/.test(leer(`services/${s}/src/app.js`) || '')));
control('health', 'cada servicio expone /health',
  SERVICIOS.every((s) => archivos.some((f) => f.startsWith(`services/${s}/src/routes/health`))));

// ---------------------------------------------------------------- 6, 8: Compose
const compose = leer('compose.yml') || leer('docker-compose.yml') || '';
control('compose', 'existe compose.yml', compose !== '');
for (const nombre of ['catalogo-service', 'inventario-1', 'inventario-2', 'inventario-3', 'ventas-service', 'catalogo-db', 'inventario-db', 'ventas-db', 'redis']) {
  control('compose', `define ${nombre} sin comentar`, new RegExp(`^  ${nombre}:`, 'm').test(compose));
}
control('compose', 'tiene healthchecks y depends_on con service_healthy', /healthcheck:/.test(compose) && /service_healthy/.test(compose));
control('compose', 'declara volúmenes con nombre y red', /^volumes:/m.test(compose) && /^networks:/m.test(compose));
control('compose', 'las bases y Redis no publican puertos al host',
  !/^  (catalogo-db|inventario-db|ventas-db|redis):[\s\S]*?\n {4}ports:/m.test(compose.split(/^  catalogo-service:/m)[0]));
control('compose', 'no hay contraseñas, tokens ni claves en compose.yml', !/(password|passwd|secret|token|api[_-]?key)\s*[:=]\s*\S+/i.test(compose));
control('compose', 'ningún bloque de servicio sigue comentado', !/^\s*#\s+(inventario-[123]|ventas-service):/m.test(compose));
if (spawnSync('docker', ['compose', 'version'], { encoding: 'utf8' }).status === 0) {
  const r = spawnSync('docker', ['compose', 'config', '-q'], { cwd: RAIZ, encoding: 'utf8' });
  control('compose', 'docker compose config valida el archivo', r.status === 0, r.stderr);
} else {
  aviso('compose', 'docker compose no está disponible: no se validó la sintaxis', true, 'correr "docker compose config -q"');
}

// ---------------------------------------------------------------- 7, 21: secretos y basura
control('limpieza', 'no hay node_modules versionado', !archivos.some((f) => /(^|\/)node_modules\//.test(f)));
control('limpieza', 'no hay .env reales versionados', !archivos.some((f) => /(^|\/)\.env($|\.(?!example))/.test(f)));
control('limpieza', 'no hay certificados ni claves versionados', !archivos.some((f) => /\.(pfx|pem|key|p12|crt)$/i.test(f)));
control('limpieza', 'no hay logs versionados', !archivos.some((f) => /\.log$|(^|\/)logs\//.test(f)));
control('limpieza', 'scripts/.datos-prueba.json no está versionado', !archivos.includes('scripts/.datos-prueba.json'));
const conSecretos = archivos.filter((f) => /\.(js|json|ya?ml|md|env\.example)$/.test(f) && !/package-lock/.test(f))
  .filter((f) => /-----BEGIN [A-Z ]*PRIVATE KEY-----|mongodb(\+srv)?:\/\/[^\s:@/<]+:[^\s@/<]+@/i.test(leer(f) || ''));
control('limpieza', 'no hay claves privadas ni URIs de Mongo con usuario y contraseña', conSecretos.length === 0, conSecretos.join(', '));

// ---------------------------------------------------------------- 9, 20: README
const readme = leer('README.md') || '';
const secciones = [
  ['arquitectura implementada', /arquitectura implementada/i], ['requisitos', /requisitos/i], ['verificar Docker', /docker --version|verificar docker/i],
  ['variables de entorno', /variables de entorno/i], ['comando para construir e iniciar', /docker compose up --build/],
  ['puertos expuestos', /puertos expuestos/i], ['Swagger y health', /api-docs/], ['pruebas', /pruebas/i],
  ['detener el entorno', /docker compose down/], ['volúmenes y persistencia', /vol[uú]menes/i],
  ['nombres internos de servicios', /nombres internos/i], ['dependencia no disponible', /no est[aá] disponible|indisponible/i],
  ['cambios respecto del TP5', /cambios respecto del TP5/i], ['local vs Compose', /local vs|ejecuci[oó]n local/i],
  ['inicio y disponibilidad', /disponibilidad/i], ['datos de prueba', /datos de prueba/i], ['fallo parcial', /fallo parcial|parcial/i],
];
for (const [nombre, re] of secciones) control('README', `README cubre: ${nombre}`, re.test(readme));
control('README', 'README tiene URL del repositorio e integrantes', /github\.com\/.+\/.+/.test(readme) && /Integrantes/i.test(readme));

// ---------------------------------------------------------------- vínculos y pendientes en docs
const rotos = [];
for (const f of archivos.filter((x) => x.endsWith('.md'))) {
  const texto = leer(f) || '';
  for (const m of texto.matchAll(/\]\(([^)#\s]+)(#[^)]*)?\)/g)) {
    const destino = m[1];
    if (/^(https?:|mailto:)/.test(destino)) continue;
    if (!fs.existsSync(path.join(RAIZ, path.dirname(f), destino))) rotos.push(`${f} → ${destino}`);
  }
}
control('docs', 'todos los vínculos relativos de los .md apuntan a archivos que existen', rotos.length === 0, rotos.slice(0, 8).join('\n     '));

const acta = leer('docs/08-ratificacion-tp6.md') || '';
control('docs', 'el acta del Hito 1 tiene fecha y no es un borrador', !/AAAA-MM-DD/.test(acta) && !/Estado: borrador/i.test(acta));
const indice = leer('docs/13-pruebas.md') || '';
const filas = indice.split('\n').filter((l) => l.startsWith('|')).join('\n');
control('docs', 'docs/13-pruebas.md no tiene pruebas "pendiente" ni "repetir con los tres"', !/pendiente|repetir con los tres|falta /i.test(filas));

// propiedad de datos, configuración por entorno y failover están en inventario-pruebas.md
const evidencias = ['build-individual', 'compose-up', 'health', 'crud-negocio', 'comunicacion', 'persistencia',
  'fallo-dependencia', 'logs', 'swagger', 'startup', 'fallo-parcial', 'datos-prueba', 'inventario-pruebas'];
for (const e of evidencias) control('evidencias', `existe docs/evidencias/${e}.md`, archivos.includes(`docs/evidencias/${e}.md`));
const dockers = archivos.filter((f) => /^docs\/evidencias\/docker-.+\.md$/.test(f));
control('evidencias', `hay evidencia de Docker de cada integrante (${dockers.length}/3)`, dockers.length >= 3, dockers.join(', '));
const conFallas = archivos.filter((f) => f.startsWith('docs/evidencias/') && f.endsWith('.md'))
  .filter((f) => /[1-9]\d* fallidas/.test(leer(f) || ''));
control('evidencias', 'ninguna evidencia generada registra verificaciones fallidas', conFallas.length === 0, conFallas.join(', '));
const conCatalogoSolo = archivos.filter((f) => f.startsWith('docs/evidencias/')).filter((f) => /todavía no tienen Dockerfile|Inventario y Ventas todavía/i.test(leer(f) || ''));
control('evidencias', 'ninguna evidencia dice que Inventario o Ventas "todavía" no tienen Dockerfile', conCatalogoSolo.length === 0, `regenerar con node scripts/generar-evidencias.js parte1 --sobrescribir: ${conCatalogoSolo.join(', ')}`);

// ---------------------------------------------------------------- Git: tag, historial, autores
const rama = git(['rev-parse', '--abbrev-ref', 'HEAD']);
aviso('git', `estás en la rama "${rama}": el tag se pone sobre main`, rama !== 'main');
const estado = git(['status', '--porcelain']);
control('git', 'no hay cambios sin commitear', estado === '', estado.split('\n').slice(0, 5).join('\n     '));
const tag = git(['tag', '--list', 'tp6-entrega']);
if (tag) {
  const mismo = git(['rev-list', '-n', '1', 'tp6-entrega']) === git(['rev-parse', 'HEAD']);
  control('git', 'el tag tp6-entrega apunta al commit actual', mismo, 'mover el tag solo si todavía no se entregó');
} else {
  aviso('git', 'todavía no existe el tag tp6-entrega', true, 'crearlo al final: git tag tp6-entrega && git push origin tp6-entrega');
}
control('git', 'existe el tag tp5-entrega (punto de partida)', git(['tag', '--list', 'tp5-entrega']) !== '');
const autores = git(['shortlog', '-sn', '--no-merges', 'HEAD']).split('\n').filter(Boolean);
control('git', `al menos 3 autores con commits (${autores.length})`, autores.length >= 3, autores.join(' | '));
const shallow = git(['rev-parse', '--is-shallow-repository']) === 'true';
aviso('git', 'el clon es superficial (shallow): la lista de autores puede estar incompleta', shallow, 'git fetch --unshallow');
aviso('git', 'los Pull Requests y las revisiones no se pueden verificar desde acá', true,
  'contarlos en GitHub: cada integrante ≥ 3 PRs propios y ≥ 2 revisiones (gh pr list --state merged --json author,reviews)');

console.log(`\n${fallas === 0 ? '✅ Todos los controles obligatorios pasaron' : `❌ ${fallas} control(es) obligatorio(s) fallaron`} · ${avisos} aviso(s)`);
process.exit(fallas === 0 ? 0 : 1);
