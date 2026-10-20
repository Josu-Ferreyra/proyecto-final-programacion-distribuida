# 8. Ratificación de la arquitectura para el TP6

> Corresponde a la sección 4 del TP6 (entregable 3). Facilita: Josué Ferreyra (Parte 1).
>
> El TP6 implementa la arquitectura que el grupo definió y justificó en el TP5
> ([`04-microservicios.md`](./04-microservicios.md), [`05-propiedad-datos.md`](./05-propiedad-datos.md),
> [`06-comunicaciones.md`](./06-comunicaciones.md) y [`diagrama-arquitectura.md`](./diagrama-arquitectura.md)).
> Se parte de `main` en el tag `tp5-entrega`. Este documento es el acta del **Hito 1**: qué
> se implementa, quién es dueño de cada parte y qué decisiones se tomaron antes de escribir
> código.

Participantes: _Josué Ferreyra, Santiago Vicente, Matías Porcari_ — fecha: _AAAA-MM-DD_

> **Estado: borrador para la reunión.** El contenido lo preparó la Parte 1 para que la
> reunión sea confirmar, no redactar. Cuando los tres lo aprueben se completan la fecha y
> los ☐ de la condición de avance (§8.5).

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

_Se completa en el siguiente commit._

## 8.5 Condición de avance

- [ ] Cada uno puede explicar qué responsabilidad implementa su servicio, qué datos puede
      modificar y qué dependencias externas necesita.
- [ ] Cada fila de la tabla 4.4 tiene dueño y columna Estado.
- [ ] D1–D7 confirmadas por los tres y registradas en este acta con su motivo.
- [ ] Convenciones del §8.3 congeladas.
- [ ] Acciones derivadas del TP5 (§7.3) marcadas como resueltas o con el PR que las resuelve.
