# Proyecto final — Programación Distribuida

Repositorio único del grupo para los trabajos prácticos a partir del TP5. En el TP5 se
parte de una API REST existente (el TP4: API de productos replicada con Raft) y se
analiza cómo descomponerla en microservicios: inventario de la aplicación actual,
responsabilidades, acoplamientos, propuesta de servicios, propiedad de los datos,
comunicaciones y diagrama de arquitectura.

Repositorio: <https://github.com/Josu-Ferreyra/proyecto-final-programacion-distribuida>

## Integrantes

| Nombre y apellido | Usuario GitHub | Parte del TP5 |
|---|---|---|
| Matías Porcari | [@matiasporcari](https://github.com/matiasporcari) | 1 · Repositorio, base e inventario |

> Cada integrante se agrega a esta tabla con su propio Pull Request
> (rama `docs/integrante-<nombre>`).

## Punto de partida

La aplicación base es el **TP4 de Santiago Vicente**: un cluster de 3 nodos con una
implementación educativa de Raft sobre la API de productos (MongoDB, Redis/Memurai,
HTTPS, Winston y Swagger). Se eligió por ser la versión más completa: instala y arranca
sin errores, todos sus endpoints funcionan y es la que más reglas de negocio tiene para
analizar.

El código está en [`app-base/`](app-base/), sin modificaciones respecto de la entrega
del TP4. Cómo instalarla y ejecutarla: [`app-base/README.md`](app-base/README.md).

## Estructura del repositorio

```
├── README.md                        ← este archivo
├── .gitignore
├── .github/
│   └── pull_request_template.md     ← plantilla que GitHub carga en cada PR
├── app-base/                        ← API REST del TP anterior (punto de partida)
│   ├── server.js                    ← arranque de un nodo (--node nodoX)
│   ├── cluster.json                 ← puertos de los 3 nodos
│   ├── .env.example                 ← plantilla de variables de entorno
│   ├── src/                         ← rutas, controlador, modelo, Raft, State Machine
│   └── scripts/                     ← seed, estado, comparación de bases, pruebas
├── services/                        ← reservado para los microservicios (TP6 en adelante)
└── docs/                            ← documentación de arquitectura del TP5
    ├── arquitectura.md              ← índice y resumen de la propuesta
    ├── 01-inventario.md             ← Parte 1
    ├── 02-responsabilidades.md      ← Parte 2
    ├── 03-acoplamientos.md          ← Parte 2
    ├── 04-microservicios.md         ← Parte 2
    ├── 05-propiedad-datos.md        ← Parte 3
    ├── 06-comunicaciones.md         ← Parte 3
    ├── 07-validacion-limites.md     ← Parte 3
    └── diagrama-arquitectura.md     ← Parte 3 (Mermaid)
```

La documentación del TP5 empieza en [`docs/arquitectura.md`](docs/arquitectura.md).

## Cómo ejecutar la aplicación base

Requisitos: Node.js 24 LTS y npm, MongoDB (local o Atlas) y
[Memurai](https://www.memurai.com) o Redis en `127.0.0.1:6379` (este último solo hace
falta para comprar). Los scripts `.ps1` requieren PowerShell.

```bash
cd app-base
npm install
cp .env.example .env        # completar con valores locales (ver tabla de abajo)
```

Opcional, para habilitar HTTPS (desde PowerShell, dentro de `app-base/`):

```powershell
.\scripts\generar-certificado.ps1 -Password "unaClaveLocal"   # misma clave en SSL_PASSPHRASE
```

Levantar los 3 nodos, cada uno en su propia terminal:

```bash
npm run nodo1
npm run nodo2
npm run nodo3
```

En Windows también se pueden abrir los tres juntos con `.\scripts\iniciar-cluster.ps1`.

A los pocos segundos uno de los nodos queda como Leader. Para verificar:

```bash
npm run estado      # un LEADER y dos FOLLOWER en el mismo término
npm run seed        # carga 3 productos a través del Leader
npm run comparar    # "CONVERGEN": las 3 bases tienen los mismos datos
```

| Nodo | API HTTP | API HTTPS | Swagger |
|---|---|---|---|
| nodo1 | http://127.0.0.1:3001 | https://127.0.0.1:3441 | http://127.0.0.1:3001/api-docs |
| nodo2 | http://127.0.0.1:3002 | https://127.0.0.1:3442 | http://127.0.0.1:3002/api-docs |
| nodo3 | http://127.0.0.1:3003 | https://127.0.0.1:3443 | http://127.0.0.1:3003/api-docs |

Las escrituras solo las acepta el Leader; un follower responde `421` e indica a qué nodo
reenviar el pedido. Todos los endpoints y las pruebas de tolerancia a fallos están en
[`app-base/README.md`](app-base/README.md).

### Variables de entorno

Van en `app-base/.env`, que **nunca** se versiona. Los valores de ejemplo están en
[`app-base/.env.example`](app-base/.env.example).

| Variable | Para qué sirve |
|---|---|
| `SSL_PFX_PATH` / `SSL_PASSPHRASE` | Certificado HTTPS de la API externa y su clave. Sin certificado, los nodos arrancan solo con HTTP |
| `MONGODB_URI` | Servidor MongoDB, sin nombre de base |
| `MONGODB_DB_PREFIX` | Prefijo de la base de cada nodo (`tp4_` → `tp4_nodo1`, `tp4_nodo2`, `tp4_nodo3`) |
| `DNS_SERVERS` | Opcional: servidores DNS a usar si el DNS local no resuelve las URIs `mongodb+srv` de Atlas |
| `REDIS_HOST` / `REDIS_PORT` / `REDIS_PASSWORD` | Redis/Memurai para el lock de la compra |
| `LOCK_TTL_MS` | Tiempo de vida del lock de compra |
| `COMPRA_DELAY_MS` | Demora artificial dentro de la compra (para observar la concurrencia) |
| `RAFT_ELECTION_TIMEOUT_MIN_MS` / `RAFT_ELECTION_TIMEOUT_MAX_MS` | Rango del election timeout aleatorio |
| `RAFT_HEARTBEAT_MS` | Intervalo de heartbeats del Leader |
| `RAFT_RPC_TIMEOUT_MS` | Timeout de cada RPC entre nodos |
| `RAFT_COMMIT_TIMEOUT_MS` | Cuánto espera el Leader la confirmación de una escritura antes de responder 503 |
| `RAFT_MAX_ENTRADAS_POR_MENSAJE` | Máximo de entradas por `AppendEntries` |
| `LOG_DIR` / `LOG_LEVEL` / `LOG_MAX_SIZE` / `LOG_MAX_FILES` | Logs de Winston (cada nodo escribe en `LOG_DIR/<nodo>/`) |

## Flujo de trabajo con Git

- Nadie trabaja directo sobre `main`: todo cambio entra por **Pull Request**.
- Cada PR necesita **al menos una aprobación** de otro integrante antes de mergearse.
- Ramas por tipo: `chore/…`, `docs/…`, `feature/…`, `fix/…`.
- Commits chicos, con mensajes descriptivos en español (por ejemplo
  `Agregar inventario de los endpoints de productos`).
- Nunca se versionan `.env`, `node_modules/`, certificados ni logs (ver `.gitignore`).

```bash
git switch main
git pull                                  # traer lo último
git switch -c docs/mi-tarea               # rama nueva para la tarea
# ... trabajar ...
git add <archivos>
git commit -m "Describir el cambio en español"
git push -u origin docs/mi-tarea
# En GitHub: abrir el Pull Request → pedir revisión → corregir → merge
git switch main
git pull
git branch -d docs/mi-tarea
```

## Entregas

| Entrega | Tag | Descripción |
|---|---|---|
| Punto de partida | `tp5-base` | API REST del TP anterior (TP4 de Santiago Vicente) en `app-base/` |
| TP5 | `tp5-entrega` | Análisis y propuesta de microservicios (`docs/`) |

Para volver a una entrega: `git switch --detach <tag>`.
