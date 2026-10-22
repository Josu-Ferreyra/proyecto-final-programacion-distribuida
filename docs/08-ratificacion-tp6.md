# 8. Ratificación de la arquitectura para el TP6

> Corresponde a la sección 4 del TP6 (entregable 3). Facilita: Josué Ferreyra (Parte 1).
>
> El TP6 implementa la arquitectura que el grupo definió y justificó en el TP5
> ([`04-microservicios.md`](./04-microservicios.md), [`05-propiedad-datos.md`](./05-propiedad-datos.md),
> [`06-comunicaciones.md`](./06-comunicaciones.md) y [`diagrama-arquitectura.md`](./diagrama-arquitectura.md)).
> Se parte de `main` en el tag `tp5-entrega`. Este documento es el acta del **Hito 1**: qué
> se implementa, quién es dueño de cada parte y qué decisiones se tomaron antes de escribir
> código.

Participantes: _Josué Ferreyra, Santiago Vicente, Matías Porcari_ — fecha: _2026-10-22_

> **Estado: cerrada el 2026-10-22.** El contenido lo preparó la Parte 1 para que la reunión
> fuera confirmar, no redactar. Los tres confirmaron D1–D7 y las convenciones; los hallazgos
> que aparecieron al implementar están en §8.7.

## 8.1 Agenda (60 min)

| Tiempo | Tema | Salida |
|---|---|---|
| 10 min | Repasar las fichas y la tabla 4.4 de `04-microservicios.md`: cada endpoint actual tiene destino | Tabla 4.4 con dueño y columna Estado |
| 25 min | Repasar las decisiones D1–D7 (§8.4) y qué implica cada una en cada servicio | D1–D7 confirmadas o con el cambio y su motivo |
| 10 min | Congelar las convenciones de ejecución (§8.3) | Puertos, nombres DNS y variables fijos |
| 10 min | Cerrar las acciones derivadas del TP5 (`07-validacion-limites.md` §7.3) y los ☐ del diagrama | Acciones con el PR que las resuelve |
| 5 min | Condición de avance (§8.5) | ☐ completos |

## 8.2 Matriz de implementación

| Microservicio | Responsable | Responsabilidad | Endpoints a implementar | Datos propios | Dependencias |
|---|---|---|---|---|---|
| Catálogo (`services/catalogo/`) | Josué Ferreyra | Definir qué se ofrece y a qué precio | `GET /productos` (filtros `nombreContiene`, `categoria`, `ids`), `GET /productos/:id`, `POST /productos`, `PUT /productos/:id`, `DELETE /productos/:id` (baja lógica), `GET /categorias`, `GET /health` | Productos, categorías válidas | Ninguna |
| Inventario (`services/inventario/`, cluster Raft de 3 nodos) | Santiago Vicente | Controlar las unidades disponibles y que nunca se vendan de más | `GET /stock?productoIds=…`, `PUT /stock/:productoId`, `POST /descuentos`, `DELETE /descuentos/:referencia`, `GET /movimientos?productoId=…`, `GET /api/cluster/estado`, `GET /api/cluster/log`, `GET /health` · internos: `/raft/*` | Stock, descuentos, movimientos, lock (interno), log y estado Raft de cada nodo | Catálogo (C4) · Redis (interno) |
| Ventas (`services/ventas/`) | Matías Porcari | Concretar compras y llevar su ciclo de vida | `POST /compras`, `GET /compras/:id`, `PATCH /compras/:id/cancelar`, `GET /health` | Compras e ítems con nombre y precio pagado | Catálogo (C1) · Inventario (C2, C3) |

**Dueño de cada endpoint anterior.** No se reescribe: se usa la tabla 4.4 de
[`04-microservicios.md`](./04-microservicios.md#44-funcionalidades-que-cambian-de-lugar),
con una columna **Estado** (`pendiente` / `implementado` / `probado`) que cada responsable
actualiza en sus PRs. Así ningún endpoint queda sin dueño y ninguna regla tiene dos.

**Tareas transversales.**

| Parte | Responsable | Tareas transversales |
|---|---|---|
| 1 | Josué Ferreyra | Este acta, Docker Compose (red, volúmenes, healthchecks), arquitectura actualizada, README, evidencias de build/compose/health/persistencia/startup/logs/Swagger, tag `tp6-entrega` |
| 2 | Santiago Vicente | Raft como módulo de infraestructura, lock Redis, configuración local vs Docker, evidencias de propiedad de datos, configuración por entorno y failover |
| 3 | Matías Porcari | Clientes HTTP, semántica de errores, compensación, fallo parcial, datos de prueba (`scripts/seed.js`), smoke test, sesión de fallos |

## 8.3 Convenciones de ejecución

Ya decidido en el TP5: Catálogo y Ventas corren como **una instancia cada uno** e
**Inventario como cluster Raft de 3 nodos** (`04-microservicios.md` §4.1, "Decisiones
transversales"). No hay API Gateway.

| Componente (nombre en Compose) | Puerto local (`npm start`) | Puerto interno (Docker) | Publicado al host | Datos |
|---|---|---|---|---|
| `catalogo-service` | 3100 | 3100 | 3100 | `catalogo-db` → `mongodb://catalogo-db:27017/catalogo` |
| `inventario-1`, `inventario-2`, `inventario-3` | API 3201–3203 · Raft 4201–4203 | API 3200 · Raft 4200 | 3201–3203 (diagnóstico y failover) | `inventario-db` → bases `inventario_nodo1..3` |
| `ventas-service` | 3300 | 3300 | 3300 | `ventas-db` → `mongodb://ventas-db:27017/ventas` |
| `redis` | 6379 (Memurai en Windows) | 6379 | no se publica | lock interno de Inventario |
| `catalogo-db`, `inventario-db`, `ventas-db` | 27017 (Mongo local) | 27017 | no se publican | — |

| Variable | Servicios | Para qué |
|---|---|---|
| `SERVICE_NAME` | todos | Nombre en logs y en `/health` |
| `PORT` | todos | Puerto HTTP de la API |
| `MONGODB_URI` | todos | Base propia del servicio (o del nodo) |
| `LOG_LEVEL` | todos | Nivel de Winston |
| `CATALOGO_SERVICE_URL` | Ventas, Inventario | `http://localhost:3100` local · `http://catalogo-service:3100` en Compose |
| `INVENTARIO_SERVICE_URL` | Ventas | `http://localhost:3201` local · `http://inventario-service:3200` en Compose |
| `HTTP_TIMEOUT_MS` | Ventas, Inventario | Timeout de las llamadas entre servicios: **3000** (TP5 §6) |
| `REDIS_URL` | Inventario | `redis://127.0.0.1:6379` local · `redis://redis:6379` en Compose |
| `RAFT_NODO_ID`, `CLUSTER_FILE`, `RAFT_COMMIT_TIMEOUT_MS` | Inventario | Identidad del nodo, topología y timeout de commit |

- **Contratos entre servicios:** son exactamente C1–C4 de
  [`06-comunicaciones.md`](./06-comunicaciones.md#62-matriz-de-comunicaciones) §6.2. No se
  redefinen: si alguno cambia, se actualiza `06-comunicaciones.md` en un PR aprobado por el
  consumidor.
- **Health:** `GET /health` → `200 { "service": "<SERVICE_NAME>", "status": "ok" }`
  (Inventario agrega `"nodo"`). Sin secretos ni URIs.
- **Errores:** se mantiene el formato de `app-base/` (`{ "error": "<mensaje>" }`) y se agrega
  el campo `servicio` con quién lo generó.
- **Logs:** Winston por stdout, con `servicio`, nivel, operación o endpoint, y el error
  cuando corresponda (Inventario agrega `nodo`).
- **Configuración:** ninguna URL ni host en el código; todo sale de variables de entorno.
  Cada servicio tiene su `.env.example`.
- **Git:** todo entra por PR con al menos una aprobación; ramas `chore/`, `docs/`,
  `feature/`, `fix/`; commits chicos y descriptivos.

## 8.4 Decisiones tomadas

Son huecos que el TP5 dejó abiertos o detalles que aparecen recién al implementar. En la
reunión se confirman; solo se reabre una si alguien trae un problema concreto del código,
y en ese caso el cambio y su motivo quedan escritos acá. Todas se registran como cambios
respecto del TP5 en [`arquitectura.md`](./arquitectura.md).

| # | Tema | Qué se decidió | Afecta a |
|---|---|---|---|
| D1 | Cómo llega Ventas al Leader de Inventario | Los followers reenvían las escrituras al Leader; los 3 nodos comparten el alias DNS `inventario-service` | Inventario, Compose |
| D2 | Bases de los 3 nodos de Inventario | Un contenedor `inventario-db` con una base por nodo, como en el TP4 | Inventario, Compose |
| D3 | Timeout de commit de Raft vs. timeout de Ventas | `RAFT_COMMIT_TIMEOUT_MS=2500`, menor que los 3000 de Ventas | Inventario, Ventas |
| D4 | Prefijo de las rutas | Sin `/api`, tal como están en las fichas; el diagnóstico `/api/cluster/*` conserva su path | Los tres |
| D5 | HTTPS | Solo HTTP en Compose; el HTTPS del TP4 queda documentado en `app-base/` | Los tres |
| D6 | Dependencia C4 (Inventario → Catálogo) | Se mantiene, como cerró el TP5 (§7.1) | Inventario, Catálogo |
| D7 | Qué guarda Ventas si falla la compensación después de un timeout | Compra `FALLIDA` con `reintegroPendiente: true`, reintentada por el mismo proceso de 30 s | Ventas |

### D1 · Cómo llega Ventas al Leader de Inventario

El TP5 dice que, para Ventas, un follower de Inventario que responde `421` o `503` es
"Inventario no disponible". Pero si `INVENTARIO_SERVICE_URL` apunta a un nodo que es
follower, **todas** las compras fallarían aunque el cluster esté sano.

| Opción | Cómo funciona | Contra |
|---|---|---|
| **A (elegida)** | El follower que recibe una escritura la **reenvía** al Leader y devuelve su respuesta. Los 3 nodos tienen el alias DNS `inventario-service` | Un salto HTTP extra cuando el pedido cae en un follower |
| B (descartada) | Ventas recibe la lista de nodos y sigue el `421` hasta el Leader | Ventas pasa a saber que Inventario usa Raft: contradice la ficha de Ventas ("Fuera de alcance") |
| C (descartada) | Literal del TP5: Ventas apunta a un nodo fijo y `421` = `503` | Funciona solo mientras ese nodo sea Leader |

Con A, los contratos C2 y C3 no cambian, Raft sigue estando "detrás de su API" (diagrama del
TP5) y un `421`/`503` sigue significando "no disponible", pero solo durante una elección.

### D2 · Bases de los 3 nodos de Inventario

El TP4 usaba un servidor Mongo con una base por nodo (`tp4_nodo1..3`). Se mantiene ese
esquema: un contenedor `inventario-db` con las bases `inventario_nodo1..3`. La sección 8 del
TP6 lo permite mientras ningún servicio acceda a la base de otro, y acá las tres bases son
del mismo servicio. Se descartó usar 3 contenedores Mongo: es más fiel a "un nodo, una
máquina", pero suma 2 contenedores sin cambiar ningún contrato.

### D3 · Timeouts

Ventas espera 3 s a Inventario (TP5 §6), pero el Leader espera el commit hasta
`RAFT_COMMIT_TIMEOUT_MS` (5 s por defecto en el TP4). Con esos valores un descuento puede
confirmarse **después** de que Ventas se rindió y ya mandó la compensación. Se fija
`RAFT_COMMIT_TIMEOUT_MS=2500`, menor que los 3000 de Ventas: si Raft no confirma a tiempo,
Inventario responde `503` antes de que Ventas corte, y Ventas recibe una respuesta en vez
de un timeout.

### D4 · Prefijo de rutas

Las fichas escriben los endpoints propuestos sin `/api` (convención de
`04-microservicios.md`). Se implementan **exactamente así**, para que la documentación,
Swagger y el código coincidan. El diagnóstico `/api/cluster/*` conserva su path, como dice la
tabla 4.4.

### D5 · HTTPS

El TP6 no exige TLS entre contenedores. En Compose todo va por HTTP dentro de la red
`backend`; el HTTPS del TP4 (puertos 3441–3443, certificado `.pfx`) queda solo en
`app-base/` y así se documenta en el README.

### D6 · Dependencia C4

El TP5 §7.1 la dejó con ⚠️ y una alternativa ("sin C4"). Se mantiene, porque así quedó en
la ficha de Inventario, se usa solo en el alta de stock y su falla deja un estado válido
(producto sin stock, que no se puede vender).

### D7 · Compensación fallida

TP5 §6.3: si C2 vence por timeout, Ventas manda C3; si C3 también falla, "se encola como en
la cancelación". Pero en ese camino la compra **no se guarda**, así que no hay dónde
encolar. Se decide guardar la compra con estado `FALLIDA` y `reintegroPendiente: true`, y que
la reintente el mismo proceso de 30 s que ya existe para `CANCELACION_PENDIENTE`. Es un
estado nuevo de Ventas: se registra como cambio respecto del TP5.

## 8.5 Condición de avance

- [x] Cada uno puede explicar qué responsabilidad implementa su servicio, qué datos puede
      modificar y qué dependencias externas necesita.
- [x] Cada fila de la tabla 4.4 tiene dueño y columna Estado.
- [x] D1–D7 confirmadas por los tres y registradas en este acta con su motivo.
- [x] Convenciones del §8.3 congeladas.
- [x] Acciones derivadas del TP5 (§7.3) marcadas como resueltas o con el PR que las resuelve.

## 8.6 Acciones derivadas del TP5

Las acciones de [`07-validacion-limites.md`](./07-validacion-limites.md#73-acciones-derivadas)
§7.3 habían quedado con PR _pendiente_. Al revisarlas contra las fichas, todas ya estaban
incorporadas por el PR #3 (`04-microservicios.md` §4.5); solo faltaba registrarlo.

| Acción derivada | Resultado |
|---|---|
| `GET /productos?ids=…` en la ficha de Catálogo | Resuelta en #3 |
| `GET /categorias` en la ficha de Catálogo | Resuelta en #3 |
| `DELETE` como baja lógica | Resuelta en #3 |
| `stock` fuera de Catálogo; ajuste en `PUT /stock/:productoId` | Resuelta en #3 |
| Lock Redis como detalle interno de Inventario | Resuelta en #3 |
| Dependencia C4 en la ficha de Inventario | Resuelta en #3 y confirmada por D6 |
| ☐ del control de coherencia del diagrama | Resuelta en esta rama |

**Control de coherencia del diagrama** (contra las fichas §4.2):

| Control | Verificación |
|---|---|
| Servicio y frase de responsabilidad | Las tres frases del diagrama resumen la "Responsabilidad principal" de su ficha |
| Bases y datos | Los datos de cada cilindro son los "Datos propios" de su ficha (Catálogo sin `stock`; el lock dentro de Inventario) |
| Sentido de las flechas | Ventas → Catálogo (C1), Ventas → Inventario (C2, C3) e Inventario → Catálogo (C4): coinciden con "Dependencias" de cada ficha; Catálogo no tiene flechas salientes |
| Flechas desde el cliente | Cada endpoint público de las fichas aparece en una flecha; `POST /descuentos` y `DELETE /descuentos/:referencia` no salen del cliente porque los usa solo Ventas |

Con esto la tabla de [`diagrama-arquitectura.md`](./diagrama-arquitectura.md#control-de-coherencia)
queda completa. El diagrama con los nodos, puertos y la red de Docker se actualiza en la
Parte 1 junto con `compose.yml`.

## 8.7 Hallazgos de la implementación

Lo que apareció al implementar y no estaba previsto en el acta. Ninguno cambia los contratos
C1–C4; el detalle completo de Ventas está en
[`12-comunicacion-y-fallos.md`](./12-comunicacion-y-fallos.md#127-diferencias-respecto-de-06-comunicacionesmd-tp5)
§12.7 y en [`arquitectura.md`](./arquitectura.md#tp6-cambios-respecto-del-tp5).

| Hallazgo | Qué se hizo |
|---|---|
| Después de un timeout de C2, un `404` de la compensación (C3) no es definitivo: el descuento puede aplicarse después | La compra queda `FALLIDA` con `reintegroPendiente` y el reintento de los 30 s la revierte. Los contratos C1–C3 no cambian |
