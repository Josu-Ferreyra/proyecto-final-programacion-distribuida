# Evidencia · Configuración por entorno

Prueba "Configuración por entorno" de la sección 18 del TP6, pasos 3 y 4 de
[`11-configuracion-por-entorno.md`](../11-configuracion-por-entorno.md) §11.3. Los pasos 1 y 2
(sin direcciones fijas en el código y modo local con `npm start`) están en
[`inventario-pruebas.md`](./inventario-pruebas.md).

Corrida del 22/10/2026 sobre el commit `cedaf24` (PR #28, el que habilitó Inventario y Ventas
en `compose.yml`), hoy en `main`.

## Paso 3 · Modo Compose

```bash
docker compose down -v
docker compose up --build -d
docker compose ps
```

```text
SERVICE            STATUS
catalogo-db        Up 18 seconds (healthy)
catalogo-service   Up 12 seconds (healthy)
inventario-1       Up 7 seconds (healthy)
inventario-2       Up 7 seconds (healthy)
inventario-3       Up 7 seconds (healthy)
inventario-db      Up 19 seconds (healthy)
redis              Up 18 seconds (healthy)
ventas-db          Up 19 seconds (healthy)
ventas-service     Up 13 seconds (healthy)
```

Las variables que recibe un nodo de Inventario salen de `compose.yml`, no del código:

```bash
docker compose exec inventario-1 node -e "for (const k of ['RAFT_NODO_ID','CLUSTER_FILE','PORT','MONGODB_URI','REDIS_URL','CATALOGO_SERVICE_URL','RAFT_COMMIT_TIMEOUT_MS','DESCUENTO_DELAY_MS']) console.log(k+'='+process.env[k])"
```

```text
RAFT_NODO_ID=inventario-1
CLUSTER_FILE=cluster.docker.json
PORT=3200
MONGODB_URI=mongodb://inventario-db:27017/inventario_nodo1
REDIS_URL=redis://redis:6379
CATALOGO_SERVICE_URL=http://catalogo-service:3100
RAFT_COMMIT_TIMEOUT_MS=2500
DESCUENTO_DELAY_MS=0
```

En modo local los mismos valores son `CLUSTER_FILE=cluster.local.json`, `PORT=3201`,
`MONGODB_URI=mongodb://127.0.0.1:27017/inventario_nodo1`, `REDIS_URL=redis://127.0.0.1:6379` y
`CATALOGO_SERVICE_URL=http://localhost:3100` (`services/inventario/.env.example`).

Datos de prueba y smoke test (los mismos scripts que en modo local):

```bash
node scripts/seed.js
node scripts/smoke-test.js
```

```text
Catálogo: http://localhost:3100 · Inventario: http://localhost:3201
┌─────────┬───────────┬────────────────────────────┬─────────────────────────┬────────┬───────┬────────┐
│ (index) │ clave     │ id                         │ nombre                  │ precio │ stock │ activo │
├─────────┼───────────┼────────────────────────────┼─────────────────────────┼────────┼───────┼────────┤
│ 0       │ 'teclado' │ '6ada9359b2a7568cbb43e652' │ 'Teclado mecánico'      │ 25000  │ 10    │ true   │
│ 1       │ 'mouse'   │ '6ada9359b2a7568cbb43e657' │ 'Mouse inalámbrico'     │ 12000  │ 10    │ true   │
│ 2       │ 'monitor' │ '6ada9359b2a7568cbb43e65c' │ 'Monitor 24"'           │ 90000  │ 10    │ true   │
│ 3       │ 'baja'    │ '6ada9359b2a7568cbb43e661' │ 'Producto dado de baja' │ 1000   │ 5     │ false  │
└─────────┴───────────┴────────────────────────────┴─────────────────────────┴────────┴───────┴────────┘
Ids guardados en scripts/.datos-prueba.json

1. Salud de los servicios
  OK    Catálogo /health (200)
  OK    Inventario http://localhost:3201 /health (200)
  OK    Inventario http://localhost:3202 /health (200)
  OK    Inventario http://localhost:3203 /health (200)
  OK    Ventas /health (200)

2. Catálogo: alta, consulta, modificación y baja lógica
  OK    Crear producto (201)
  OK    Leer producto (200)
  OK    Modificar precio (200)
  OK    Rechazar stock en Catálogo (400)
  OK    Dar de baja (lógica) (204)
  OK    Sigue existiendo, inactivo (200)

3. Inventario: disponibilidad
  OK    Consultar stock del teclado (200)

4. Ventas: registrar compras (C1 + C2)
  OK    Comprar 1 teclado (201)
  OK    El stock bajó 1 unidad
  OK    Comprar más unidades de las que hay (409)
  OK    Comprar un producto inexistente (400)
  OK    Comprar el producto dado de baja (409)
  OK    Los rechazos no tocaron el stock

5. Ventas: consultar y cancelar (C3)
  OK    Consultar la compra (200)
  OK    Inventario registró el DESCUENTO con referencia = compraId
  OK    Cancelar la compra (200)
  OK    El stock volvió al valor inicial
  OK    Cancelar otra vez (409)

23 OK, 0 FAIL
```

## Paso 4 · Sin cambios de código entre un modo y el otro

Lo único que cambió para pasar al modo Compose completo fue configuración: el PR #28 tocó
`compose.yml` y la documentación, y ningún archivo de `services/`.

```bash
git diff --stat 883164f^1 883164f          # el merge del PR #28
```

```text
 compose.yml                 | 115 ++++++++++++++++++++++----------------------
 docs/09-ejecucion-docker.md |   5 +-
 2 files changed, 59 insertions(+), 61 deletions(-)
```

```bash
git diff --stat 883164f^1 883164f -- services/                 # sin resultados
grep -rnE "localhost|127\.0\.0\.1|mongodb://|redis://" services/*/src   # sin resultados
```

**Resultado:** el mismo código corre con `npm start` y con `docker compose up --build`. Las
diferencias de hosts, puertos, bases, Redis, topología Raft y URLs de los otros servicios se
resuelven solo con variables de entorno y con el archivo de topología que elige `CLUSTER_FILE`.
