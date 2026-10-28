# Proyecto final — Programación Distribuida

Repositorio único del grupo para los trabajos prácticos a partir del TP5. Se parte de una
API REST existente (el TP4: API de productos replicada con Raft), en el TP5 se analizó cómo
descomponerla en microservicios, en el TP6 esa arquitectura se implementó y se ejecuta con
**Docker Compose**, y en el TP7 se le agregó **identidad, autenticación y autorización** con
un servicio `auth-service` y tokens JWT.

Repositorio: <https://github.com/Josu-Ferreyra/proyecto-final-programacion-distribuida>

## Integrantes

| Nombre y apellido | Usuario GitHub | Parte del TP5 | Parte del TP6 | Parte del TP7 |
|---|---|---|---|---|
| Matías Porcari | [@matiasporcari](https://github.com/matiasporcari) | 1 · Repositorio, base e inventario | 3 · Ventas, comunicación y fallos | 3 · Ventas, propiedad del recurso y propagación |
| Santiago Vicente | [@santivicente](https://github.com/santivicente) | 2 · Responsabilidades, acoplamientos y propuesta de microservicios | 2 · Inventario replicado | 2 · Modelo de seguridad, validación e Inventario |
| Josué Ferreyra | [@Josu-Ferreyra](https://github.com/Josu-Ferreyra) | 3 · Datos, comunicación y arquitectura | 1 · Catálogo, integración y entrega | 1 · Identidad (`auth-service`), Catálogo e integración |

## 1. Arquitectura implementada

Tres microservicios de negocio, uno por responsabilidad, más un servicio de identidad. Se
llaman por HTTP sin ciclos y sin acceder a la base de otro. No hay API Gateway: el cliente
llama a cada servicio.

| Servicio | Responsabilidad | Carpeta | Instancias |
|---|---|---|---|
| **auth-service** (TP7) | Registrar usuarios, verificar credenciales y emitir el JWT | [`services/auth/`](services/auth/) | 1 |
| **Catálogo** | Definir qué productos se ofrecen, en qué categoría y a qué precio | [`services/catalogo/`](services/catalogo/) | 1 |
| **Inventario** | Controlar cuántas unidades hay y que nunca se venda de más | [`services/inventario/`](services/inventario/) | Cluster Raft de 3 nodos |
| **Ventas** | Concretar las compras y llevar su ciclo de vida | [`services/ventas/`](services/ventas/) | 1 |

Ventas consulta productos a Catálogo (C1) y le pide a Inventario descontar y reintegrar
unidades (C2, C3); Inventario verifica en Catálogo que el producto exista al dar de alta su
stock (C4). `auth-service` emite los tokens, pero **nadie lo consulta para validarlos**: cada
servicio verifica el JWT localmente con el mismo `JWT_SECRET`. La única llamada hacia él es
el login de la cuenta técnica de Ventas. Diagramas lógico y de despliegue (TP6 y TP7):
[`docs/diagrama-arquitectura.md`](docs/diagrama-arquitectura.md). Toda la documentación
empieza en [`docs/arquitectura.md`](docs/arquitectura.md).

## 2. Cambios respecto del TP5 y del TP6

Las responsabilidades, la propiedad de los datos y los contratos C1–C4 no cambiaron. Al
implementar el TP6 se tomaron siete decisiones (D1–D7), por ejemplo que los followers de
Inventario reenvían las escrituras al Leader y que Ventas guarda una compra `FALLIDA` si
falla la compensación. Todas, con su motivo, en
[`docs/arquitectura.md`](docs/arquitectura.md#tp6-cambios-respecto-del-tp5) y en el acta de
ratificación [`docs/08-ratificacion-tp6.md`](docs/08-ratificacion-tp6.md).

El TP7 agregó `auth-service` y la protección con JWT (decisiones D8–D16 en
[`docs/14-modelo-seguridad.md`](docs/14-modelo-seguridad.md), resumen en
[`docs/arquitectura.md`](docs/arquitectura.md#tp7-identidad-y-seguridad)).

### Roles y qué puede hacer cada uno

| Rol | Quién | Puede |
|---|---|---|
| `CLIENTE` | Cualquiera que se registre con `POST /auth/register` | Comprar, y consultar o cancelar **sus** compras |
| `ADMIN` | El primero se crea al arrancar (`ADMIN_EMAIL`); los demás, con `POST /auth/usuarios` | Administrar productos, stock y usuarios; ver todas las compras |
| `SERVICIO` | La cuenta técnica de Ventas (`ventas@servicio.local`), creada al arrancar | Descontar y reintegrar stock en Inventario (C2, C3) |

Las consultas de la oferta (`GET /productos`, `GET /categorias`, `GET /stock`), `/health` y
`/api-docs` siguen siendo públicas. Matriz completa por endpoint:
[`docs/14-modelo-seguridad.md`](docs/14-modelo-seguridad.md).

### Propagación de la identidad y caída de auth-service (D13, D15)

- **D13:** Ventas valida el token del cliente y llama a Inventario con **su propio** token de
  servicio (rol `SERVICIO`), no con el del cliente. El cliente viaja como **contexto**: el
  `usuarioId` en el body de C2, que Inventario guarda en el descuento y en los movimientos.
  Así un `CLIENTE` no puede descontar stock directamente, y el reintento de compensación de
  30 s no depende de un token de cliente que pudo haber vencido. Detalle en
  [`docs/17-propagacion-identidad.md`](docs/17-propagacion-identidad.md).
- **D15:** si `auth-service` se cae, los tokens ya emitidos **se siguen validando** en cada
  servicio y solo fallan el login y el registro. Ningún servicio tiene `depends_on` hacia él.

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

Desde el TP7 **hace falta un `.env` en la raíz** con los secretos, que no se versiona.
Compose lo lee solo y, si falta alguno, no arranca y dice cuál:

```bash
cp .env.example .env
node -e "console.log(require('crypto').randomBytes(48).toString('base64'))"   # pegarlo en JWT_SECRET
# y cambiar ADMIN_PASSWORD y VENTAS_SERVICE_PASSWORD (8 a 72 caracteres)
```

| Variable del `.env` | Obligatoria | Para qué |
|---|---|---|
| `JWT_SECRET` | Sí (≥ 32 caracteres) | Firma y validación de los JWT (HS256), la misma en los 4 servicios |
| `ADMIN_PASSWORD` | Sí | Password del primer `ADMIN`, que `auth-service` crea al arrancar si no existe |
| `VENTAS_SERVICE_PASSWORD` | Sí | Password de la cuenta técnica de Ventas (`ventas@servicio.local`) |
| `ADMIN_EMAIL` | No (`admin@tp7.local`) | Email del primer `ADMIN` |
| `JWT_EXPIRES_IN` | No (`15m`) | Vencimiento del token; se puede bajar a `30s` para probar el token vencido |
| `LOG_LEVEL` | No (`info`) | Nivel de logs de todos los servicios |

El resto de las variables está en [`compose.yml`](compose.yml). Para el modo local, cada
servicio tiene su `.env.example` (`services/<servicio>/.env.example`), con el mismo
`JWT_SECRET` en todos.

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
| `JWT_SECRET`, `JWT_ISSUER` | todos | Validar (y en auth, firmar) los tokens | en cada `.env` | `${JWT_SECRET:?…}` del `.env` · `auth-service` |
| `JWT_EXPIRES_IN`, `BCRYPT_ROUNDS`, `ADMIN_*`, `VENTAS_SERVICE_*` | auth | Vencimiento, costo del hash y cuentas iniciales | ver su `.env.example` | del `.env` · 12 |
| `AUTH_SERVICE_URL`, `VENTAS_SERVICE_EMAIL`, `VENTAS_SERVICE_PASSWORD` | Ventas | Login de la cuenta técnica (D13) | `http://localhost:3400` | `http://auth-service:3400` |

Ningún `.env` se versiona. Si en la raíz quedó un `.env` del TP4, hay que moverlo a
`app-base/` y crear el nuevo desde `.env.example`: Compose lee el de la raíz.

## 6. Construir e iniciar

Desde la raíz del repositorio:

```bash
cp .env.example .env             # una sola vez, y completar los secretos (sección 5)
docker compose up --build -d     # construye las imágenes y levanta todo
docker compose ps                # esperar a que los 11 contenedores digan "healthy" (~30 s)
node scripts/seed.js             # cargar los datos de prueba (Parte 3)
node scripts/smoke-test.js       # prueba de punta a punta, con login
```

### 6.1 Registrarse, hacer login y usar el token

```bash
# 1. Registrarse (siempre crea un CLIENTE)
curl -X POST http://localhost:3400/auth/register -H "Content-Type: application/json" \
  -d '{"email":"ana@ejemplo.com","password":"una-password-larga"}'

# 2. Login: devuelve { accessToken, tokenType: "Bearer", expiresIn: 900 }
TOKEN=$(curl -s -X POST http://localhost:3400/auth/login -H "Content-Type: application/json" \
  -d '{"email":"ana@ejemplo.com","password":"una-password-larga"}' \
  | node -pe 'JSON.parse(require("fs").readFileSync(0)).accessToken')

# 3. Usarlo en cualquier servicio, en el header Authorization
curl http://localhost:3400/auth/me -H "Authorization: Bearer $TOKEN"
curl -X POST http://localhost:3300/compras -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" -d '{"items":[{"productoId":"<id>","cantidad":1}]}'
```

Para administrar (crear productos, fijar stock) se hace login con `admin@tp7.local` y el
`ADMIN_PASSWORD` del `.env`. El token dura 15 minutos: al vencer, se repite el login.

**Desde Swagger:** abrir <http://localhost:3400/api-docs>, ejecutar `POST /auth/login`,
copiar el `accessToken`, ir al Swagger del servicio que se quiere usar, tocar **Authorize**
y pegar el token (sin la palabra `Bearer`). Los endpoints protegidos muestran un candado.

Sin token, con un token vencido o modificado, la respuesta es `401` (`Token ausente`,
`Token inválido` o `Token vencido`); con un rol que no alcanza, `403 Permisos insuficientes`.

> En PowerShell usar `curl.exe` y `$TOKEN = (curl.exe ... | ConvertFrom-Json).accessToken`.

## 7. Puertos expuestos al host

| Puerto | Contenedor | Uso |
|---|---|---|
| 3400 | `auth-service` | Registro, login y administración de usuarios |
| 3100 | `catalogo-service` | API de Catálogo |
| 3201, 3202, 3203 | `inventario-1`, `-2`, `-3` | API de cada nodo (diagnóstico y failover) |
| 3300 | `ventas-service` | API de Ventas |

Las bases, Redis y los puertos Raft (4200) **no** se publican.

## 8. Swagger y health checks

| Servicio | Swagger | Health |
|---|---|---|
| auth-service | <http://localhost:3400/api-docs> | <http://localhost:3400/health> |
| Catálogo | <http://localhost:3100/api-docs> | <http://localhost:3100/health> |
| Inventario (nodo 1, 2, 3) | <http://localhost:3201/api-docs> | <http://localhost:3201/health> · `:3202` · `:3203` |
| Ventas | <http://localhost:3300/api-docs> | <http://localhost:3300/health> |

`GET /health` responde `200 { "service": "<nombre>", "status": "ok" }` y no consulta la base.

## 9. Nombres internos dentro de Compose

Dentro de la red `backend` los contenedores se llaman por nombre, nunca por `localhost`:

| Desde | Hacia | URL |
|---|---|---|
| Ventas (login de la cuenta técnica) | auth-service | `http://auth-service:3400` |
| Ventas, Inventario | Catálogo | `http://catalogo-service:3100` |
| Ventas | Inventario (cualquiera de los 3 nodos, D1) | `http://inventario-service:3200` |
| Nodo de Inventario | Otro nodo (Raft) | `http://inventario-2:4200` |
| Inventario | Redis | `redis://redis:6379` |
| Cada servicio | Su base | `mongodb://catalogo-db:27017/catalogo`, `…inventario-db…`, `…ventas-db…`, `…auth-db…/auth` |

Detalle y URLs incorrectas frecuentes: [`docs/09-ejecucion-docker.md`](docs/09-ejecucion-docker.md#92-red-y-nombres-dns-sección-12).

## 10. Estrategia de inicio y disponibilidad

- Cada base, Redis y cada servicio tienen **healthcheck**.
- Cada servicio arranca recién cuando **su propia base** está `healthy` (`depends_on` por
  salud). Ventas **no** depende de Catálogo ni de Inventario: si no están, responde `503`.
- **Nadie** depende de `auth-service` (D15): los tokens se validan localmente, así que si
  `auth-service` tarda en arrancar o se cae, solo fallan el login y el registro.
- Cada servicio **reintenta** la conexión a Mongo al arrancar y, si la base se cae después,
  responde `503` sin colgarse; vuelve solo cuando la base vuelve. Si los reintentos se
  agotan, `restart: on-failure` lo reinicia.

## 11. Volúmenes y persistencia

Los datos de `catalogo-db`, `inventario-db`, `ventas-db` y `auth-db` viven en los volúmenes
`catalogo-data`, `inventario-data`, `ventas-data` y `auth-data`. Los usuarios sobreviven a un
reinicio (prueba K), y las cuentas iniciales no se vuelven a crear ni cambian de password.

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

Para probar sin pasar por `auth-service`, `node scripts/token.js --rol ADMIN` genera un token
de desarrollo firmado con el `JWT_SECRET` del `.env` (no es un endpoint: necesita el secreto).

## 14. Pruebas

El índice de pruebas de la sección 18, con su responsable, el comando para repetirlas y la
evidencia, está en [`docs/13-pruebas.md`](docs/13-pruebas.md). Prueba rápida de punta a
punta: `node scripts/smoke-test.js`.

**Pruebas de seguridad del TP7 (A–L):** el índice, con el responsable y la evidencia de cada
una, está en [`docs/18-pruebas-seguridad.md`](docs/18-pruebas-seguridad.md). Todas se corren
con el entorno levantado y los comandos exactos están en cada evidencia
(`docs/evidencias/seguridad-<letra>-*.md`):

| | Prueba | Evidencia |
|---|---|---|
| A · B | Registro válido (`201`, sin hash) y duplicado (`409`) | [A](docs/evidencias/seguridad-a-registro.md) · [B](docs/evidencias/seguridad-b-duplicado.md) |
| C · D | Login válido (payload del JWT) y password incorrecta (`401`, igual que email inexistente) | [C](docs/evidencias/seguridad-c-login.md) · [D](docs/evidencias/seguridad-d-password-incorrecta.md) |
| E · F · G | Sin token, token modificado y token vencido (`401`) | ver [`docs/18`](docs/18-pruebas-seguridad.md) |
| H · I | Rol insuficiente (`403`) y rol autorizado | ver [`docs/18`](docs/18-pruebas-seguridad.md) · [Catálogo](docs/evidencias/seguridad-catalogo.md) |
| J | Compra que atraviesa Ventas e Inventario con propagación de identidad | ver [`docs/18`](docs/18-pruebas-seguridad.md) |
| K · L | Reinicio con Compose (los usuarios persisten) y hash bcrypt en la base | [K](docs/evidencias/seguridad-k-reinicio.md) · [L](docs/evidencias/seguridad-l-hash.md) |

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
| TP7 | `tp7-entrega` | Identidad (`auth-service`), autenticación y autorización con JWT |

Para volver a una entrega: `git switch --detach <tag>`.

## Estructura del repositorio

```
├── README.md                  ← este archivo
├── compose.yml                ← entorno completo con Docker Compose (11 contenedores)
├── .env.example               ← secretos y variables de Compose (copiar como .env)
├── .github/pull_request_template.md
├── services/
│   ├── auth/                  ← auth-service: identidad y JWT (TP7, Parte 1)
│   ├── catalogo/              ← Servicio de Catálogo (Parte 1)
│   ├── inventario/            ← Servicio de Inventario, cluster Raft (Parte 2)
│   └── ventas/                ← Servicio de Ventas (Parte 3)
├── scripts/                   ← datos de prueba, smoke test y token.js de desarrollo
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
- Commits chicos y descriptivos: en español hasta el TP6; desde el TP7, en inglés imperativo
  (`Add JWT authentication middleware`). Títulos de PR en español.
- Nunca se versionan `.env`, `node_modules/`, certificados ni logs (ver `.gitignore`).

```bash
git switch main
git pull                                  # traer lo último
git switch -c feature/mi-tarea            # rama nueva para la tarea
# ... trabajar ...
git add <archivos>                        # nunca "git add ."
git commit -m "Describe the change"       # inglés imperativo (TP7)
git push -u origin feature/mi-tarea
# En GitHub: abrir el Pull Request → pedir revisión → corregir → merge
git switch main
git pull
git branch -d feature/mi-tarea
```
