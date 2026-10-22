# 11. Configuración por entorno

> TP6 · Parte 2 · Responsable: Santiago Vicente. Cubre la sección 6.3 del TP6 y la prueba
> "Configuración por entorno" de la sección 18.

El mismo código corre con `npm start` y con Docker Compose. Todo lo que cambia entre un entorno
y otro (hosts, puertos, bases, Redis, URLs de los otros servicios, topología del cluster) es
**configuración**: variables de entorno y el archivo de topología de Inventario.

## 11.1 Diferencias entre entornos

| Aspecto | Ejecución local (`npm start`) | Docker Compose |
|---|---|---|
| Cómo se inicia | Catálogo, los 3 nodos de Inventario (`services/inventario/scripts/iniciar-local.ps1`) y Ventas, cada uno con `npm start` | `docker compose up --build` |
| De dónde salen las variables | `services/<servicio>/.env`, copiado de `.env.example` | `environment:` de `compose.yml` |
| Puertos de las APIs | 3100 · 3201–3203 (Raft 4201–4203) · 3300 | Internos 3100 · 3200 (Raft 4200) · 3300; publicados 3100 · 3201–3203 · 3300 |
| Topología Raft | `CLUSTER_FILE=cluster.local.json` | `CLUSTER_FILE=cluster.docker.json` |
| MongoDB | Servidor local en 27017: bases `catalogo`, `inventario_nodo1..3`, `ventas` | `catalogo-db`, `inventario-db` (3 bases, D2), `ventas-db`; no se publican |
| Redis | Memurai (Windows) o Redis local en 6379 | Contenedor `redis`; no se publica |
| URLs entre servicios | `http://localhost:<puerto>` | `http://<nombre-en-compose>:<puerto-interno>` |

## 11.2 Variables de Inventario por entorno

| Variable | Local | Compose |
|---|---|---|
| `RAFT_NODO_ID` | `inventario-1..3` (lo pone `iniciar-local.ps1`) | `inventario-1..3` (cada bloque del compose) |
| `CLUSTER_FILE` | `cluster.local.json` | `cluster.docker.json` |
| `PORT` | opcional (3201–3203) | `3200` |
| `MONGODB_URI` | `mongodb://127.0.0.1:27017/inventario_nodoN` | `mongodb://inventario-db:27017/inventario_nodoN` |
| `REDIS_URL` | `redis://127.0.0.1:6379` | `redis://redis:6379` |
| `CATALOGO_SERVICE_URL` | `http://localhost:3100` | `http://catalogo-service:3100` |
| `HTTP_TIMEOUT_MS` · `RAFT_COMMIT_TIMEOUT_MS` | 3000 · 2500 | 3000 · 2500 |

Desde la PC del desarrollador, los nodos de Inventario se alcanzan en los mismos puertos en los
dos modos (3201–3203), así que los scripts de diagnóstico (`estado-cluster.js`) sirven para ambos.

## 11.3 Prueba "Configuración por entorno"

1. **Sin direcciones fijas en el código** (sin resultados):

   ```bash
   grep -rnE "localhost|127\.0\.0\.1|mongodb://|redis://" services/*/src
   ```

   Resultado para Inventario: sin resultados. Las direcciones locales viven solo en
   `.env.example` y en `cluster.local.json`, que son configuración.

2. **Modo local:** con Mongo y Memurai corriendo, levantar Catálogo (`npm start` en
   `services/catalogo`), los 3 nodos (`.\scripts\iniciar-local.ps1` en `services/inventario`) y
   Ventas, y correr el smoke test de la Parte 3.
   Resultado para Inventario: los 3 nodos eligen Leader y responden C2, C3 y C4 contra el
   Catálogo real (detalle en [`evidencias/inventario-pruebas.md`](./evidencias/inventario-pruebas.md)).

3. Detener todo. **Modo Compose:** `docker compose up --build -d`, cargar los datos de prueba y
   correr el mismo smoke test.

4. `git status` → ningún archivo de `src/` cambió entre un modo y el otro.

> **Estado:** los pasos 1 y 2 están verificados para Inventario. Los pasos 3 y 4 se completan
> cuando estén integrados en `compose.yml` los bloques de Inventario (hoy comentados en
> `feature/compose-integration`, a la espera de este Dockerfile) y el servicio de Ventas.
