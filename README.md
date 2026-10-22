# Proyecto final — Programación Distribuida

Repositorio único del grupo para los trabajos prácticos a partir del TP5. Se parte de una
API REST existente (el TP4: API de productos replicada con Raft), en el TP5 se analizó cómo
descomponerla en microservicios y en el TP6 esa arquitectura se implementó y se ejecuta con
**Docker Compose**.

Repositorio: <https://github.com/Josu-Ferreyra/proyecto-final-programacion-distribuida>

## Integrantes

| Nombre y apellido | Usuario GitHub | Parte del TP5 | Parte del TP6 |
|---|---|---|---|
| Matías Porcari | [@matiasporcari](https://github.com/matiasporcari) | 1 · Repositorio, base e inventario | 3 · Ventas, comunicación y fallos |
| Santiago Vicente | [@santivicente](https://github.com/santivicente) | 2 · Responsabilidades, acoplamientos y propuesta de microservicios | 2 · Inventario replicado |
| Josué Ferreyra | [@Josu-Ferreyra](https://github.com/Josu-Ferreyra) | 3 · Datos, comunicación y arquitectura | 1 · Catálogo, integración y entrega |

## 1. Arquitectura implementada

Tres microservicios, uno por responsabilidad de negocio, que se llaman por HTTP sin ciclos
y sin acceder a la base de otro. No hay API Gateway: el cliente llama a cada servicio.

| Servicio | Responsabilidad | Carpeta | Instancias |
|---|---|---|---|
| **Catálogo** | Definir qué productos se ofrecen, en qué categoría y a qué precio | [`services/catalogo/`](services/catalogo/) | 1 |
| **Inventario** | Controlar cuántas unidades hay y que nunca se venda de más | [`services/inventario/`](services/inventario/) | Cluster Raft de 3 nodos |
| **Ventas** | Concretar las compras y llevar su ciclo de vida | [`services/ventas/`](services/ventas/) | 1 |

Ventas consulta productos a Catálogo (C1) y le pide a Inventario descontar y reintegrar
unidades (C2, C3); Inventario verifica en Catálogo que el producto exista al dar de alta su
stock (C4). Diagramas lógico y de despliegue: [`docs/diagrama-arquitectura.md`](docs/diagrama-arquitectura.md).
Toda la documentación empieza en [`docs/arquitectura.md`](docs/arquitectura.md).

## 2. Cambios respecto del TP5

Las responsabilidades, la propiedad de los datos y los contratos C1–C4 no cambiaron. Al
implementar se tomaron siete decisiones (D1–D7), por ejemplo que los followers de
Inventario reenvían las escrituras al Leader y que Ventas guarda una compra `FALLIDA` si
falla la compensación. Todas, con su motivo, en
[`docs/arquitectura.md`](docs/arquitectura.md#tp6-cambios-respecto-del-tp5) y en el acta de
ratificación [`docs/08-ratificacion-tp6.md`](docs/08-ratificacion-tp6.md).

## 3. Requisitos

- **Con Docker (recomendado):** Docker Desktop con WSL 2 (Windows/macOS) o Docker Engine con
  el plugin Compose (Linux). Nada más: Node, MongoDB y Redis corren en contenedores.
- **Modo local, sin Docker:** Node.js 24 LTS y npm, MongoDB en `127.0.0.1:27017` y
  Memurai (Windows) o Redis en `127.0.0.1:6379` (solo para Inventario).

## 4. Verificar Docker

```bash
wsl --status              # solo Windows
docker --version
docker compose version
docker info               # tiene que mostrar la sección "Server" sin errores
docker run --rm hello-world
```

En Linux, si `docker info` dice `permission denied ... docker.sock`, el usuario no está en
el grupo `docker`: `sudo usermod -aG docker $USER` y volver a iniciar sesión.

## 5. Variables de entorno

En Compose todas las variables están en [`compose.yml`](compose.yml) y **no hace falta crear
ningún `.env`**. El [`.env.example`](.env.example) de la raíz solo permite cambiar
`LOG_LEVEL`. Para el modo local, cada servicio tiene su `.env.example`
(`services/<servicio>/.env.example`).

| Variable | Servicios | Para qué | Local | Compose |
|---|---|---|---|---|
| `SERVICE_NAME` | todos | Nombre en logs, en `/health` y en los errores | `catalogo-service`, … | igual |
| `PORT` | todos | Puerto HTTP de la API | 3100 · 3201–3203 · 3300 | 3100 · 3200 · 3300 |
| `MONGODB_URI` | todos | Base propia del servicio o del nodo | `mongodb://127.0.0.1:27017/<base>` | `mongodb://<servicio>-db:27017/<base>` |
| `LOG_LEVEL` | todos | Nivel de Winston | `info` | `${LOG_LEVEL:-info}` |
| `CATALOGO_SERVICE_URL` | Ventas, Inventario | URL de Catálogo | `http://localhost:3100` | `http://catalogo-service:3100` |
| `INVENTARIO_SERVICE_URL` | Ventas | URL de Inventario | `http://localhost:3201` | `http://inventario-service:3200` |
| `HTTP_TIMEOUT_MS` | Ventas, Inventario | Timeout entre servicios | 3000 | 3000 |
| `REDIS_URL` | Inventario | Lock interno | `redis://127.0.0.1:6379` | `redis://redis:6379` |
| `RAFT_NODO_ID`, `CLUSTER_FILE`, `RAFT_COMMIT_TIMEOUT_MS` | Inventario | Identidad del nodo, topología y timeout de commit | ver su `.env.example` | `inventario-N`, `cluster.docker.json`, 2500 |

Ningún `.env` se versiona. Si en la raíz quedó un `.env` del TP4, conviene borrarlo o
moverlo a `app-base/`: Compose lo lee automáticamente.

## 6. Construir e iniciar

Desde la raíz del repositorio:

```bash
docker compose up --build -d     # construye las imágenes y levanta todo
docker compose ps                # esperar a que todo diga "healthy" (~30 s)
node scripts/seed.js             # cargar los datos de prueba (Parte 3)
```

## 7. Puertos expuestos al host

| Puerto | Contenedor | Uso |
|---|---|---|
| 3100 | `catalogo-service` | API de Catálogo |
| 3201, 3202, 3203 | `inventario-1`, `-2`, `-3` | API de cada nodo (diagnóstico y failover) |
| 3300 | `ventas-service` | API de Ventas |

Las bases, Redis y los puertos Raft (4200) **no** se publican.

## 8. Swagger y health checks

| Servicio | Swagger | Health |
|---|---|---|
| Catálogo | <http://localhost:3100/api-docs> | <http://localhost:3100/health> |
| Inventario (nodo 1, 2, 3) | <http://localhost:3201/api-docs> | <http://localhost:3201/health> · `:3202` · `:3203` |
| Ventas | <http://localhost:3300/api-docs> | <http://localhost:3300/health> |

`GET /health` responde `200 { "service": "<nombre>", "status": "ok" }` y no consulta la base.

## 9. Nombres internos dentro de Compose

Dentro de la red `backend` los contenedores se llaman por nombre, nunca por `localhost`:

| Desde | Hacia | URL |
|---|---|---|
| Ventas, Inventario | Catálogo | `http://catalogo-service:3100` |
| Ventas | Inventario (cualquiera de los 3 nodos, D1) | `http://inventario-service:3200` |
| Nodo de Inventario | Otro nodo (Raft) | `http://inventario-2:4200` |
| Inventario | Redis | `redis://redis:6379` |
| Cada servicio | Su base | `mongodb://catalogo-db:27017/catalogo`, `…inventario-db…`, `…ventas-db…` |

Detalle y URLs incorrectas frecuentes: [`docs/09-ejecucion-docker.md`](docs/09-ejecucion-docker.md#92-red-y-nombres-dns-sección-12).

## 10. Estrategia de inicio y disponibilidad

- Cada base, Redis y cada servicio tienen **healthcheck**.
- Cada servicio arranca recién cuando **su propia base** está `healthy` (`depends_on` por
  salud). Ventas **no** depende de Catálogo ni de Inventario: si no están, responde `503`.
- Cada servicio **reintenta** la conexión a Mongo al arrancar y, si la base se cae después,
  responde `503` sin colgarse; vuelve solo cuando la base vuelve. Si los reintentos se
  agotan, `restart: on-failure` lo reinicia.

## 11. Volúmenes y persistencia

Los datos de `catalogo-db`, `inventario-db` y `ventas-db` viven en los volúmenes
`catalogo-data`, `inventario-data` y `ventas-data`.

- `docker compose down` borra los contenedores y **conserva** los datos.
- `docker compose down -v` **borra** los volúmenes: usarlo solo para reiniciar el
  laboratorio a propósito, y después volver a correr `node scripts/seed.js`.

## 12. Ejecución local vs Compose

Cada servicio corre también con `npm start` (sin Docker), con su `.env`:

```bash
cd services/catalogo && cp .env.example .env && npm install && npm start
```

Las diferencias (URLs, Redis/Memurai, puertos de los nodos, logs) están en
[`docs/09-ejecucion-docker.md`](docs/09-ejecucion-docker.md#96-ejecución-local-vs-compose) y,
variable por variable, en [`docs/11-configuracion-por-entorno.md`](docs/11-configuracion-por-entorno.md).

## 13. Datos de prueba

`node scripts/seed.js` carga productos en Catálogo y su stock en Inventario a través de las
APIs, y se puede repetir. Detalle en [`scripts/README.md`](scripts/README.md).

## 14. Pruebas

El índice de pruebas de la sección 18, con su responsable, el comando para repetirlas y la
evidencia, está en [`docs/13-pruebas.md`](docs/13-pruebas.md). Prueba rápida de punta a
punta: `node scripts/smoke-test.js`.

Las evidencias se generan con la salida real de los comandos, y antes de entregar se revisa
la lista de la sección 21 del TP:

```bash
node scripts/generar-evidencias.js lista                 # pruebas disponibles
node scripts/generar-evidencias.js health --sobrescribir # una prueba (escribe docs/evidencias/health.md)
node scripts/verificar-entrega.js                        # controles de la entrega (no necesita Docker)
```

## 15. Si una dependencia no está disponible

| Si se cae… | Pasa |
|---|---|
| La base de un servicio | Ese servicio responde `503 { error, servicio }` y vuelve solo cuando la base vuelve |
| Catálogo | Ventas responde `503` a las compras y no descuenta stock; Inventario responde `503` al alta de stock |
| Inventario | Ventas responde `503` y no guarda la compra (con compensación si hubo timeout) |
| Un nodo de Inventario | El cluster sigue con mayoría; si era el Leader, se elige otro en segundos |

Análisis completo, incluido el fallo parcial y la compensación:
[`docs/12-comunicacion-y-fallos.md`](docs/12-comunicacion-y-fallos.md).

## 16. Detener el entorno

```bash
docker compose stop        # detiene sin borrar nada
docker compose down        # borra los contenedores, conserva los datos
docker compose down -v     # borra también los datos (reinicio del laboratorio)
```

## 17. Entregas

| Entrega | Tag | Descripción |
|---|---|---|
| Punto de partida | `tp5-base` | API REST del TP4 (de Santiago Vicente) en `app-base/` |
| TP5 | `tp5-entrega` | Análisis y propuesta de microservicios (`docs/`) |
| TP6 | `tp6-entrega` | Microservicios implementados y ejecutables con Docker Compose |

Para volver a una entrega: `git switch --detach <tag>`.

## Estructura del repositorio

```
├── README.md                  ← este archivo
├── compose.yml                ← entorno completo con Docker Compose
├── .env.example               ← variables opcionales de Compose
├── .github/pull_request_template.md
├── services/
│   ├── catalogo/              ← Servicio de Catálogo (Parte 1)
│   ├── inventario/            ← Servicio de Inventario, cluster Raft (Parte 2)
│   └── ventas/                ← Servicio de Ventas (Parte 3)
├── scripts/                   ← datos de prueba y smoke test (Parte 3)
├── docs/                      ← arquitectura, decisiones, ejecución y pruebas
│   └── evidencias/            ← evidencias de las pruebas
└── app-base/                  ← API REST del TP4 (punto de partida, sin cambios)
```

## Aplicación base (TP4)

El código del TP4 sigue en [`app-base/`](app-base/), sin modificaciones, como referencia:
es el único lugar con HTTPS (decisión D5). Cómo ejecutarla:
[`app-base/README.md`](app-base/README.md).

## Flujo de trabajo con Git

- Nadie trabaja directo sobre `main`: todo cambio entra por **Pull Request**, con la
  plantilla de `.github/pull_request_template.md`.
- Cada PR necesita **al menos una aprobación** de otro integrante antes de mergearse.
- Ramas por tipo: `chore/…`, `docs/…`, `feature/…`, `fix/…`.
- Commits chicos, con mensajes descriptivos en español.
- Nunca se versionan `.env`, `node_modules/`, certificados ni logs (ver `.gitignore`).

```bash
git switch main
git pull                                  # traer lo último
git switch -c feature/mi-tarea            # rama nueva para la tarea
# ... trabajar ...
git add <archivos>
git commit -m "Describir el cambio en español"
git push -u origin feature/mi-tarea
# En GitHub: abrir el Pull Request → pedir revisión → corregir → merge
git switch main
git pull
git branch -d feature/mi-tarea
```
