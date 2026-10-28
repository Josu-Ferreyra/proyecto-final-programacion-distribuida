# Servicio de Inventario

Única autoridad sobre cuántas unidades de cada producto están disponibles. Corre como un
cluster Raft de 3 nodos (`inventario-1..3`) con la misma imagen; lo que distingue a cada nodo
es configuración. Diseño completo en [`docs/10-inventario-replicado.md`](../../docs/10-inventario-replicado.md).

## Endpoints

| Endpoint | Qué hace |
|---|---|
| `GET /stock?productoIds=a,b` | Disponibilidad (0 si no hay stock registrado). **Público** |
| `PUT /stock/:productoId` `{ cantidad }` | Alta (verifica con Catálogo, C4) o ajuste. **ADMIN** |
| `POST /descuentos` `{ referencia, items, usuarioId }` | C2: descuento todo o nada, idempotente por referencia. **SERVICIO o ADMIN** |
| `DELETE /descuentos/:referencia` | C3: reintegra exactamente lo descontado. **SERVICIO o ADMIN** |
| `GET /movimientos?productoId=…` | Historial de cambios, con el `usuarioId` de cada uno. **ADMIN** |
| `GET /api/cluster/estado` · `GET /api/cluster/log` | Diagnóstico Raft del nodo. El estado es **público**; el log, **ADMIN** |
| `GET /health` | `{ service, nodo, status }` |

Swagger: `http://localhost:3201/api-docs` (o 3202, 3203). Los RPC internos de Raft se documentan
en `http://localhost:4201/raft-docs` (solo entre nodos, no se publican en Compose).

Los endpoints protegidos piden `Authorization: Bearer <token>` (TP7). El token se obtiene con
`POST /auth/login` en `auth-service`, o para pruebas con `node scripts/token.js --rol ADMIN` desde la
raíz. Sin token, con token vencido o mal firmado: `401`. Con un rol que no alcanza: `403`. Detalle en
`docs/16-validacion-jwt.md`.

## Ejecución local

Requisitos: Node.js 24, MongoDB en 27017, Memurai/Redis en 6379 y Catálogo en 3100.

```powershell
cd services/inventario
npm install
cp .env.example .env
.\scripts\iniciar-local.ps1        # una ventana por nodo (puertos 3201-3203, Raft 4201-4203)
node scripts/estado-cluster.js     # quién es el Leader
node scripts/comparar-bases.js     # ¿las 3 bases convergen?
```

Las variables están documentadas en [`.env.example`](./.env.example). Diferencias con Compose:
[`docs/11-configuracion-por-entorno.md`](../../docs/11-configuracion-por-entorno.md).

## Docker

```bash
docker build -t grupo/inventario:tp6 ./services/inventario
```

Prueba de la imagen sola, con un nodo que es Leader de sí mismo (`cluster.solo.json`):

```bash
docker network create tp6-prueba
docker run -d --rm --name inventario-db --network tp6-prueba mongo:7
docker run -d --rm --name redis --network tp6-prueba redis:7-alpine
docker run --rm --name inventario-1 --network tp6-prueba -p 3201:3200 \
  -e RAFT_NODO_ID=inventario-1 -e CLUSTER_FILE=cluster.solo.json \
  -e MONGODB_URI=mongodb://inventario-db:27017/inventario_nodo1 -e REDIS_URL=redis://redis:6379 \
  -e CATALOGO_SERVICE_URL=http://catalogo-service:3100 grupo/inventario:tp6
```

En Compose, los 3 nodos usan `CLUSTER_FILE=cluster.docker.json` y comparten el alias
`inventario-service` (D1).
