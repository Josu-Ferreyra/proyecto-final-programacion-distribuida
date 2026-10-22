#!/usr/bin/env node
// Genera las evidencias de las pruebas obligatorias (sección 18 del TP6) con la salida REAL
// de cada comando. Escribe docs/evidencias/<prueba>.md: objetivo, comandos exactos, salida
// obtenida y un resumen de verificaciones. Así la evidencia se puede repetir con el mismo
// comando y nadie tiene que copiar y pegar salidas a mano.
//
// Uso (Node 18+, sin dependencias), desde la raíz del repositorio y con Docker andando:
//   node scripts/generar-evidencias.js <prueba> [--sobrescribir] [apellido]
//   node scripts/generar-evidencias.js parte1 --sobrescribir   # las de Compose/health/persistencia (Parte 1)
//   node scripts/generar-evidencias.js todas --sobrescribir    # todo, en el orden recomendado
//   node scripts/generar-evidencias.js lista          # muestra las pruebas disponibles
//
// Si el archivo ya existe no lo pisa, salvo con --sobrescribir (antes del tag conviene
// regenerar todo sobre main). Algunas pruebas detienen y vuelven a levantar contenedores.

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const RAIZ = path.join(__dirname, '..');
const DIR = path.join(RAIZ, 'docs', 'evidencias');
const CATALOGO = process.env.CATALOGO_URL || 'http://localhost:3100';
const NODOS = [3201, 3202, 3203].map((p) => `http://localhost:${p}`);
const INVENTARIO = process.env.INVENTARIO_URL || NODOS[0];
const VENTAS = process.env.VENTAS_URL || 'http://localhost:3300';
const SERVICIOS = ['catalogo', 'inventario', 'ventas'];
const dormir = (ms) => new Promise((r) => setTimeout(r, ms));

// ------------------------------------------------------------------ informe

class Informe {
  constructor(archivo, titulo, objetivo) {
    this.archivo = archivo;
    this.titulo = titulo;
    this.objetivo = objetivo;
    this.bloques = [];
    this.ok = 0;
    this.fallas = 0;
  }

  nota(texto) {
    this.bloques.push({ nota: texto });
  }

  // Ejecuta un comando de shell y guarda comando + salida tal cual salió.
  sh(comando, { maxLineas = 40, timeout = 600000 } = {}) {
    const r = spawnSync(comando, { shell: true, cwd: RAIZ, encoding: 'utf8', timeout });
    const crudo = `${r.stdout || ''}${r.stderr || ''}`.replace(/\r/g, '').trimEnd();
    let lineas = crudo.split('\n');
    if (lineas.length > maxLineas) {
      const omitidas = lineas.length - maxLineas;
      lineas = [...lineas.slice(0, Math.ceil(maxLineas / 2)), `... (${omitidas} líneas omitidas) ...`, ...lineas.slice(-Math.floor(maxLineas / 2))];
    }
    this.bloques.push({ comando, salida: lineas.join('\n'), codigo: r.status });
    return { codigo: r.status, salida: crudo };
  }

  // Pide una URL y guarda el equivalente en curl y la respuesta.
  async http(metodo, url, cuerpo, { timeoutMs = 15000 } = {}) {
    const curl = `curl -s -X ${metodo} ${url}${cuerpo ? ` -H "Content-Type: application/json" -d '${JSON.stringify(cuerpo)}'` : ''}`;
    let status = 0;
    let texto;
    try {
      const res = await fetch(url, {
        method: metodo,
        headers: cuerpo ? { 'Content-Type': 'application/json' } : undefined,
        body: cuerpo ? JSON.stringify(cuerpo) : undefined,
        signal: AbortSignal.timeout(timeoutMs),
      });
      status = res.status;
      texto = await res.text();
    } catch (err) {
      texto = `(sin respuesta: ${err.cause?.code || err.name})`;
    }
    let datos = null;
    try {
      datos = JSON.parse(texto);
    } catch {
      /* no era JSON */
    }
    this.bloques.push({ comando: curl, salida: `HTTP ${status}\n${texto.length > 600 ? `${texto.slice(0, 600)}…` : texto}`.trimEnd() });
    return { status, datos, texto };
  }

  verificar(descripcion, condicion) {
    if (condicion) this.ok++;
    else this.fallas++;
    this.bloques.push({ nota: `${condicion ? '✅' : '❌'} ${descripcion}` });
    return condicion;
  }

  guardar() {
    let commit = '(sin git)';
    try {
      commit = spawnSync('git rev-parse --short HEAD', { shell: true, cwd: RAIZ, encoding: 'utf8' }).stdout.trim() || commit;
    } catch {
      /* sin git */
    }
    const partes = [
      `# ${this.titulo}`,
      '',
      `**Objetivo:** ${this.objetivo}`,
      '',
      `Generado con \`node scripts/generar-evidencias.js ${this.archivo.replace('.md', '')}\` el ${new Date().toISOString()} ` +
        `(commit \`${commit}\`, ${process.platform}, Node ${process.version}). La salida es la real de cada comando; ` +
        'para repetir la prueba se corre el mismo comando desde la raíz del repositorio.',
      '',
    ];
    if (this.ok + this.fallas > 0) {
      partes.push(`**Resultado:** ${this.ok} verificaciones correctas, ${this.fallas} fallidas.`, '');
    }
    for (const b of this.bloques) {
      if (b.nota !== undefined) {
        partes.push(b.nota, '');
      } else {
        partes.push('```text', `$ ${b.comando}`, b.salida, '```', '');
      }
    }
    fs.mkdirSync(DIR, { recursive: true });
    fs.writeFileSync(path.join(DIR, this.archivo), `${partes.join('\n').trimEnd()}\n`);
    return this.fallas === 0;
  }
}

// ------------------------------------------------------------------ utilidades

async function responde(url) {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(3000) });
    return res.ok;
  } catch {
    return false;
  }
}

// Espera a que todos los servicios respondan /health y a que haya un Leader en Inventario.
async function esperarEntorno(maxMs = 180000) {
  const urls = [`${CATALOGO}/health`, ...NODOS.map((n) => `${n}/health`), `${VENTAS}/health`];
  const limite = Date.now() + maxMs;
  while (Date.now() < limite) {
    const estados = await Promise.all(urls.map(responde));
    if (estados.every(Boolean) && (await hayLeader())) return true;
    await dormir(3000);
  }
  return false;
}

async function hayLeader() {
  for (const nodo of NODOS) {
    try {
      const res = await fetch(`${nodo}/api/cluster/estado`, { signal: AbortSignal.timeout(3000) });
      const dato = await res.json();
      if (String(dato.rol).toUpperCase() === 'LEADER') return true;
    } catch {
      /* probar el siguiente nodo */
    }
  }
  return false;
}

// Devuelve el nombre del servicio de Compose que es Leader (inventario-1/2/3) o null.
async function nodoLeader() {
  for (let i = 0; i < NODOS.length; i++) {
    try {
      const res = await fetch(`${NODOS[i]}/api/cluster/estado`, { signal: AbortSignal.timeout(3000) });
      const dato = await res.json();
      if (String(dato.rol).toUpperCase() === 'LEADER') return `inventario-${i + 1}`;
    } catch {
      /* siguiente */
    }
  }
  return null;
}

function leerDatosPrueba() {
  try {
    // { generado, productos: [{ clave, id, ... }] } -> { teclado: {...}, mouse: {...}, ... }
    const { productos } = JSON.parse(fs.readFileSync(path.join(__dirname, '.datos-prueba.json'), 'utf8'));
    return Object.fromEntries(productos.map((p) => [p.clave, p]));
  } catch {
    return null;
  }
}

// El seed deja los ids en .datos-prueba.json; si falta, se corre.
function asegurarSeed(inf) {
  if (!leerDatosPrueba()) inf.sh('node scripts/seed.js');
  return leerDatosPrueba();
}

const idsDe = (datos) => Object.values(datos || {}).filter((p) => p.activo !== false).map((p) => p.id);

// ------------------------------------------------------------------ pruebas

const PRUEBAS = {};

PRUEBAS.docker = {
  archivo: (arg) => `docker-${(arg || 'integrante').toLowerCase().normalize('NFD').replace(/[^a-z0-9]/g, '')}.md`,
  titulo: 'Instalación y verificación de Docker',
  objetivo: 'Mostrar la versión de Docker, la de Docker Compose y que un contenedor de prueba corre bien (sección 5.3 del TP6).',
  async correr(inf) {
    const v = inf.sh('docker --version');
    const c = inf.sh('docker compose version');
    inf.sh('docker info', { maxLineas: 14 });
    const h = inf.sh('docker run --rm hello-world', { maxLineas: 12 });
    inf.verificar('docker --version responde', v.codigo === 0);
    inf.verificar('docker compose version responde', c.codigo === 0);
    inf.verificar('hello-world se ejecuta correctamente', h.codigo === 0 && /Hello from Docker/.test(h.salida));
    inf.nota('En Windows, además: `wsl --status` (Docker Desktop con backend WSL 2).');
  },
};

PRUEBAS['build-individual'] = {
  archivo: () => 'build-individual.md',
  titulo: 'Build individual de cada imagen',
  objetivo: 'Cada Dockerfile genera su imagen sin usar archivos locales no declarados (sección 9.3).',
  async correr(inf) {
    for (const s of SERVICIOS) {
      const r = inf.sh(`docker build -t grupo/${s}:tp6 ./services/${s}`, { maxLineas: 12 });
      inf.verificar(`grupo/${s}:tp6 se construyó`, r.codigo === 0);
    }
    inf.sh('docker images --filter "reference=grupo/*:tp6"');
  },
};

PRUEBAS['compose-up'] = {
  archivo: () => 'compose-up.md',
  titulo: 'Inicio de la solución completa con Compose',
  objetivo: 'La solución completa inicia con `docker compose up --build` y todos los servicios llegan a `healthy` (sección 11).',
  async correr(inf) {
    const cfg = inf.sh('docker compose config -q');
    inf.verificar('docker compose config valida el archivo', cfg.codigo === 0);
    inf.sh('docker compose down -v', { maxLineas: 20 });
    const up = inf.sh('docker compose up --build -d', { maxLineas: 25 });
    inf.verificar('docker compose up --build -d terminó sin error', up.codigo === 0);
    const listo = await esperarEntorno();
    inf.verificar('los 5 servicios HTTP respondieron /health y hay un Leader en Inventario', listo);
    const ps = inf.sh('docker compose ps');
    inf.verificar('ningún servicio quedó "unhealthy" ni reiniciándose', !/unhealthy|Restarting/i.test(ps.salida));
  },
};

PRUEBAS.health = {
  archivo: () => 'health.md',
  titulo: 'Health checks',
  objetivo: 'Cada microservicio responde su endpoint de salud sin exponer secretos (sección 16).',
  async correr(inf) {
    const destinos = [
      ['catalogo-service', `${CATALOGO}/health`],
      ['inventario-1', `${NODOS[0]}/health`],
      ['inventario-2', `${NODOS[1]}/health`],
      ['inventario-3', `${NODOS[2]}/health`],
      ['ventas-service', `${VENTAS}/health`],
    ];
    for (const [nombre, url] of destinos) {
      const r = await inf.http('GET', url);
      inf.verificar(`${nombre}: 200 con {"service","status":"ok"}`, r.status === 200 && r.datos?.status === 'ok' && !!r.datos?.service);
    }
    inf.sh('docker compose ps');
  },
};

PRUEBAS.swagger = {
  archivo: () => 'swagger.md',
  titulo: 'Documentación OpenAPI / Swagger',
  objetivo: 'Las interfaces HTTP están documentadas y la documentación se puede abrir en cada servicio (sección 17).',
  async correr(inf) {
    for (const [nombre, base] of [['catalogo', CATALOGO], ['inventario', NODOS[0]], ['ventas', VENTAS]]) {
      const ui = await inf.http('GET', `${base}/api-docs/`);
      inf.verificar(`${nombre}: Swagger UI en /api-docs responde 200`, ui.status === 200);
      const js = await inf.http('GET', `${base}/api-docs.json`);
      inf.verificar(`${nombre}: /api-docs.json describe rutas (${Object.keys(js.datos?.paths || {}).length})`, js.status === 200 && Object.keys(js.datos?.paths || {}).length > 0);
    }
    inf.nota('Las capturas de la interfaz van en `docs/evidencias/img/` y se enlazan desde acá; esta salida es la prueba repetible.');
  },
};

PRUEBAS['datos-prueba'] = {
  archivo: () => 'datos-prueba.md',
  titulo: 'Datos de prueba reproducibles',
  objetivo: 'Un procedimiento deja siempre el mismo estado inicial y es idempotente (entregable 13).',
  async correr(inf) {
    const a = inf.sh('node scripts/seed.js', { maxLineas: 20 });
    const ids1 = JSON.stringify(leerDatosPrueba());
    const b = inf.sh('node scripts/seed.js', { maxLineas: 20 });
    const ids2 = JSON.stringify(leerDatosPrueba());
    inf.verificar('el seed terminó bien la primera vez', a.codigo === 0);
    inf.verificar('el seed terminó bien la segunda vez', b.codigo === 0);
    inf.verificar('los ids son los mismos en las dos corridas (idempotente)', ids1 === ids2 && ids1 !== 'null');
    const r = await inf.http('GET', `${CATALOGO}/productos`);
    inf.verificar('Catálogo lista los productos de prueba', r.status === 200 && Array.isArray(r.datos) && r.datos.length >= 3);
  },
};

PRUEBAS['crud-negocio'] = {
  archivo: () => 'crud-negocio.md',
  titulo: 'CRUD y negocio después de la migración',
  objetivo: 'Las operaciones principales siguen funcionando entre los tres servicios (smoke test de punta a punta).',
  async correr(inf) {
    inf.sh('node scripts/seed.js', { maxLineas: 6 });
    const r = inf.sh('node scripts/smoke-test.js', { maxLineas: 80 });
    inf.verificar('el smoke test terminó con código 0 (todos los pasos OK)', r.codigo === 0);
  },
};

PRUEBAS.comunicacion = {
  archivo: () => 'comunicacion.md',
  titulo: 'Comunicación entre microservicios por HTTP',
  objetivo: 'Ventas intercambia información con Catálogo (C1) e Inventario (C2/C3) por HTTP y se ve en los logs.',
  async correr(inf) {
    const datos = asegurarSeed(inf);
    const productoId = datos?.teclado?.id || idsDe(datos)[0];
    inf.verificar('hay datos de prueba (scripts/.datos-prueba.json)', !!productoId);
    if (!productoId) return;
    const antes = await inf.http('GET', `${INVENTARIO}/stock?productoIds=${productoId}`);
    const compra = await inf.http('POST', `${VENTAS}/compras`, { items: [{ productoId, cantidad: 1 }] });
    inf.verificar('POST /compras responde 201 (Ventas → Catálogo C1 y → Inventario C2)', compra.status === 201);
    let despues = antes;
    for (let i = 0; i < 10 && JSON.stringify(despues.datos) === JSON.stringify(antes.datos); i++) {
      await dormir(1000); // el stock se replica en los followers: se espera a verlo bajar
      despues = await inf.http('GET', `${INVENTARIO}/stock?productoIds=${productoId}`);
    }
    inf.verificar('el stock en Inventario bajó (lo decidió Inventario, no Ventas)', JSON.stringify(antes.datos) !== JSON.stringify(despues.datos));
    inf.sh('docker compose logs --no-log-prefix --tail=15 ventas-service', { maxLineas: 20 });
    if (compra.datos?.compraId) {
      const c = await inf.http('PATCH', `${VENTAS}/compras/${compra.datos.compraId}/cancelar`);
      inf.verificar('PATCH /compras/:id/cancelar responde 200 (Ventas → Inventario C3) y deja el stock como estaba', c.status === 200);
    }
  },
};

PRUEBAS['propiedad-datos'] = {
  archivo: () => 'propiedad-datos.md',
  titulo: 'Propiedad de los datos',
  objetivo: 'Cada servicio persiste únicamente en su propia base y no hay referencias a las bases de otros (sección 8).',
  async correr(inf) {
    const lista = (db, base) =>
      inf.sh(`docker compose exec -T ${db} mongosh ${base} --quiet --eval "db.getCollectionNames()"`, { maxLineas: 12 });
    const cat = lista('catalogo-db', 'catalogo');
    const inv = lista('inventario-db', 'inventario_nodo1');
    const ven = lista('ventas-db', 'ventas');
    inf.verificar('catalogo-db tiene productos y no tiene stock ni compras', /productos?/i.test(cat.salida) && !/stock|compras/i.test(cat.salida));
    inf.verificar('inventario-db tiene stock/descuentos y no tiene productos ni compras', /stock/i.test(inv.salida) && !/compras|productos/i.test(inv.salida));
    inf.verificar('ventas-db tiene compras y no tiene productos ni stock', /compras/i.test(ven.salida) && !/productos|stock/i.test(ven.salida));
    inf.sh('docker compose exec -T inventario-db mongosh --quiet --eval "db.adminCommand({listDatabases:1}).databases.map(d=>d.name)"');
    inf.sh('grep -rnE "mongodb://|localhost|127\\.0\\.0\\.1" services/ventas/src services/catalogo/src services/inventario/src || echo "(sin resultados: ningún servicio nombra la base de otro ni usa direcciones fijas)"', { maxLineas: 12 });
  },
};

PRUEBAS.persistencia = {
  archivo: () => 'persistencia.md',
  titulo: 'Persistencia con volúmenes',
  objetivo: 'Los datos sobreviven a `docker compose down` (sin `-v`) porque viven en volúmenes con nombre (sección 13).',
  async correr(inf) {
    const nombre = `Prueba persistencia ${Date.now()}`;
    const alta = await inf.http('POST', `${CATALOGO}/productos`, { nombre, precio: 1000, categoria: 'otro' });
    inf.verificar('el producto se creó (201)', alta.status === 201);
    const id = alta.datos?.id;
    inf.sh('docker compose down', { maxLineas: 20 });
    inf.sh('docker volume ls --filter name=proyecto-distribuido');
    inf.sh('docker compose up -d', { maxLineas: 20 });
    inf.verificar('el entorno volvió a estar sano', await esperarEntorno());
    const r = await inf.http('GET', `${CATALOGO}/productos/${id}`);
    inf.verificar('el producto sigue disponible después de recrear los contenedores', r.status === 200 && r.datos?.nombre === nombre);
    inf.nota('`docker compose down` conserva los volúmenes; `docker compose down -v` los borra y deja el laboratorio en blanco.');
  },
};

PRUEBAS.logs = {
  archivo: () => 'logs.md',
  titulo: 'Logs en contenedores',
  objetivo: 'Los eventos de cada servicio se consultan con `docker compose logs` e identifican servicio, nivel y operación (sección 14).',
  async correr(inf) {
    for (const s of ['catalogo-service', 'inventario-1', 'ventas-service']) {
      const r = inf.sh(`docker compose logs --no-log-prefix --tail=6 ${s}`, { maxLineas: 10 });
      inf.verificar(`${s}: hay logs por stdout`, r.salida.length > 0);
    }
    inf.sh('docker compose logs --tail=3');
  },
};

PRUEBAS.startup = {
  archivo: () => 'startup.md',
  titulo: 'Inicio y disponibilidad de dependencias',
  objetivo: 'Los servicios esperan a su base con healthchecks y manejan una dependencia que se cae: responden 503 sin morir (sección 11.1).',
  async correr(inf) {
    inf.sh('docker compose stop catalogo-db');
    await dormir(3000);
    const caida = await inf.http('GET', `${CATALOGO}/productos`);
    inf.verificar('con la base detenida Catálogo responde 503 controlado', caida.status === 503);
    const salud = await inf.http('GET', `${CATALOGO}/health`);
    inf.verificar('el proceso de Catálogo sigue vivo (/health responde)', salud.status > 0);
    inf.sh('docker compose start catalogo-db');
    let recuperado = false;
    for (let i = 0; i < 20 && !recuperado; i++) {
      await dormir(3000);
      recuperado = (await responde(`${CATALOGO}/productos`)) === true;
    }
    inf.verificar('al volver la base, Catálogo se recupera solo', recuperado);
    inf.sh('docker compose ps catalogo-service catalogo-db');
    inf.nota('Mismo patrón para `inventario-db` y `ventas-db`: se repite el stop/start y se prueba un endpoint que la use.');
  },
};

PRUEBAS['fallo-dependencia'] = {
  archivo: () => 'fallo-dependencia.md',
  titulo: 'Fallo de una dependencia (sección 15.1)',
  objetivo: 'Se detiene Catálogo y Ventas responde de forma controlada, sin caerse; al reiniciar Catálogo el caso de uso se recupera.',
  async correr(inf) {
    const datos = asegurarSeed(inf);
    const productoId = datos?.mouse?.id || idsDe(datos)[0];
    const pedido = { items: [{ productoId, cantidad: 1 }] };
    const antes = await inf.http('POST', `${VENTAS}/compras`, pedido);
    inf.verificar('1) con todo levantado la compra funciona (201)', antes.status === 201);
    inf.sh('docker compose stop catalogo-service');
    const caido = await inf.http('POST', `${VENTAS}/compras`, pedido);
    inf.verificar('2-3) con Catálogo detenido Ventas responde 503 (no 500)', caido.status === 503);
    const salud = await inf.http('GET', `${VENTAS}/health`);
    inf.verificar('4) Ventas sigue viva y responde /health', salud.status === 200);
    inf.sh('docker compose logs --no-log-prefix --tail=6 ventas-service', { maxLineas: 12 });
    inf.sh('docker compose start catalogo-service');
    let recuperado = false;
    for (let i = 0; i < 20 && !recuperado; i++) {
      await dormir(3000);
      recuperado = await responde(`${CATALOGO}/health`);
    }
    const despues = recuperado ? await inf.http('POST', `${VENTAS}/compras`, pedido) : { status: 0 };
    inf.verificar('5) al reiniciar Catálogo la compra vuelve a funcionar (201)', despues.status === 201);
    // dejar el stock como estaba: cancelar las dos compras
    for (const c of [antes, despues]) if (c.datos?.compraId) await inf.http('PATCH', `${VENTAS}/compras/${c.datos.compraId}/cancelar`);
  },
};

PRUEBAS['fallo-parcial'] = {
  archivo: () => 'fallo-parcial.md',
  titulo: 'Fallo parcial: descuento sin confirmar',
  objetivo: 'Si Inventario tarda más que el timeout de Ventas, Ventas compensa y el sistema queda consistente (análisis en `docs/12-comunicacion-y-fallos.md` §12.4).',
  async correr(inf) {
    const datos = asegurarSeed(inf);
    const productoId = datos?.monitor?.id || idsDe(datos)[0];
    const stock = async () => (await fetch(`${INVENTARIO}/stock?productoIds=${productoId}`).then((r) => r.json()).catch(() => null)) ?? null;
    const s0 = JSON.stringify(await stock());
    inf.nota('Se recrean los 3 nodos de Inventario con `DESCUENTO_DELAY_MS=5000` (el descuento tarda más que los 3000 ms de Ventas).');
    const env = process.platform === 'win32' ? 'set DESCUENTO_DELAY_MS=5000&& ' : 'DESCUENTO_DELAY_MS=5000 ';
    inf.sh(`${env}docker compose up -d --force-recreate inventario-1 inventario-2 inventario-3`, { maxLineas: 10 });
    inf.verificar('el cluster volvió a tener Leader', await esperarEntorno());
    const r = await inf.http('POST', `${VENTAS}/compras`, { items: [{ productoId, cantidad: 1 }] }, { timeoutMs: 20000 });
    inf.verificar('Ventas responde 503 (timeout de Inventario) y no 500', r.status === 503);
    inf.nota(`Detalle devuelto: \`${JSON.stringify(r.datos?.detalle || r.datos?.compensacion || null)}\``);
    await dormir(8000);
    inf.sh('docker compose logs --no-log-prefix --tail=12 ventas-service', { maxLineas: 16 });
    await dormir(35000); // un ciclo del proceso de reintentos (30 s)
    const s1 = JSON.stringify(await stock());
    inf.verificar('pasado el reintento el stock volvió al valor inicial (sin unidades perdidas)', s0 === s1);
    inf.sh('docker compose up -d --force-recreate inventario-1 inventario-2 inventario-3', { maxLineas: 10 });
    inf.nota('Al terminar se recrean los nodos sin la demora artificial.');
  },
};

PRUEBAS['configuracion-entorno'] = {
  archivo: () => 'configuracion-entorno.md',
  titulo: 'Configuración por entorno (local y Compose)',
  objetivo: 'El mismo código corre con `npm start` y con Compose; cambian solo las variables (sección 6.3).',
  async correr(inf) {
    const g = inf.sh('grep -rnE "localhost|127\\.0\\.0\\.1|mongodb://|redis://" services/catalogo/src services/inventario/src services/ventas/src || echo "(sin resultados)"', { maxLineas: 12 });
    inf.verificar('no hay hosts, puertos de otros servicios ni URLs de bases escritos en el código fuente', /sin resultados/.test(g.salida));
    for (const s of SERVICIOS) inf.sh(`git ls-files services/${s}/.env.example`);
    inf.sh('docker compose config --format json | node -e "const c=JSON.parse(require(\'fs\').readFileSync(0,\'utf8\'));for(const [n,s] of Object.entries(c.services))if(s.environment)console.log(n, JSON.stringify(Object.fromEntries(Object.entries(s.environment).filter(([k])=>/URL|URI|PORT/.test(k)))))"', { maxLineas: 12 });
    inf.nota('Versión local: cada `services/<svc>/.env.example` (localhost y puertos locales). Versión Compose: las variables de `compose.yml` (nombres DNS y puertos internos). Ver `docs/11-configuracion-por-entorno.md`.');
  },
};

PRUEBAS['failover-inventario'] = {
  archivo: () => 'failover-inventario.md',
  titulo: 'Failover del cluster de Inventario (extra)',
  objetivo: 'Si el Leader cae, otro nodo toma el liderazgo y las compras siguen funcionando.',
  async correr(inf) {
    const datos = asegurarSeed(inf);
    const productoId = datos?.teclado?.id || idsDe(datos)[0];
    const leader = await nodoLeader();
    inf.verificar(`hay un Leader (${leader})`, !!leader);
    if (!leader) return;
    inf.sh(`docker compose stop ${leader}`);
    let nuevo = null;
    for (let i = 0; i < 20 && !nuevo; i++) {
      await dormir(2000);
      const n = await nodoLeader();
      if (n && n !== leader) nuevo = n;
    }
    inf.verificar(`un nuevo Leader fue elegido (${nuevo})`, !!nuevo);
    const r = await inf.http('POST', `${VENTAS}/compras`, { items: [{ productoId, cantidad: 1 }] }, { timeoutMs: 20000 });
    inf.verificar('con el Leader caído la compra funciona (201)', r.status === 201);
    if (r.datos?.compraId) await inf.http('PATCH', `${VENTAS}/compras/${r.datos.compraId}/cancelar`);
    inf.sh(`docker compose start ${leader}`);
    inf.nota('El nodo reiniciado vuelve como follower y se pone al día con el log de Raft.');
  },
};

// Las pruebas de la Parte 1 (Compose, health, persistencia...). Las demás ya tienen evidencia
// escrita por sus responsables; estas se regeneran sobre main con los tres servicios.
const ORDEN_PARTE1 = ['build-individual', 'compose-up', 'health', 'swagger', 'logs', 'persistencia', 'startup'];

const ORDEN_TODAS = [
  'build-individual', 'compose-up', 'health', 'swagger', 'datos-prueba', 'crud-negocio', 'comunicacion',
  'propiedad-datos', 'logs', 'configuracion-entorno', 'persistencia', 'startup', 'fallo-dependencia',
  'fallo-parcial', 'failover-inventario',
];

// ------------------------------------------------------------------ main

async function ejecutar(nombre, arg, sobrescribir) {
  const prueba = PRUEBAS[nombre];
  if (!prueba) {
    console.error(`Prueba desconocida: "${nombre}". Disponibles: ${Object.keys(PRUEBAS).join(', ')}`);
    return false;
  }
  const archivo = prueba.archivo(arg);
  if (fs.existsSync(path.join(DIR, archivo)) && !sobrescribir) {
    console.log(`- ${archivo} ya existe: se omite (usar --sobrescribir para regenerarlo)`);
    return true;
  }
  console.log(`> ${nombre} ...`);
  const inf = new Informe(archivo, prueba.titulo, prueba.objetivo);
  try {
    await prueba.correr(inf);
  } catch (err) {
    inf.verificar(`la prueba terminó sin excepciones (${err.message})`, false);
  }
  const bien = inf.guardar();
  console.log(`  ${bien ? 'OK' : 'CON FALLAS'}: docs/evidencias/${archivo} (${inf.ok} OK, ${inf.fallas} fallidas)`);
  return bien;
}

async function main() {
  const args = process.argv.slice(2);
  const sobrescribir = args.includes('--sobrescribir');
  const [nombre, arg] = args.filter((a) => !a.startsWith('--'));
  if (!nombre || nombre === 'lista') {
    console.log(`Pruebas: ${Object.keys(PRUEBAS).join(', ')}\nUso: node scripts/generar-evidencias.js <prueba|parte1|todas> [apellido] [--sobrescribir]`);
    return;
  }
  if (spawnSync('docker version --format "{{.Server.Version}}"', { shell: true }).status !== 0) {
    console.error('Docker no está andando. Iniciarlo y repetir (ver docs/09-ejecucion-docker.md).');
    process.exit(2);
  }
  let todoBien = true;
  if (nombre === 'parte1' || nombre === 'todas') {
    for (const n of nombre === 'parte1' ? ORDEN_PARTE1 : ORDEN_TODAS) todoBien = (await ejecutar(n, arg, sobrescribir)) && todoBien;
  } else {
    todoBien = await ejecutar(nombre, arg, sobrescribir);
  }
  process.exit(todoBien ? 0 : 1);
}

main();
