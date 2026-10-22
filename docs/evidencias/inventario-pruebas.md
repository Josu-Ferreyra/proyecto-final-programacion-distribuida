# Evidencias · Inventario (Parte 2)

Pruebas corridas en modo local (`npm start`) el 22/10/2026, con MongoDB y Redis locales, el
Catálogo real en 3100 y los 3 nodos de Inventario con `CLUSTER_FILE=cluster.local.json`.
Cada sección incluye los comandos para repetirla (bash; en PowerShell usar `curl.exe`).

Para levantar el entorno:

```bash
cd services/catalogo && npm start                 # en otra terminal
cd services/inventario && npm install
cp .env.example .env
.\scripts\iniciar-local.ps1                         # PowerShell: abre los 3 nodos
node scripts/estado-cluster.js                      # quién es el Leader
```

## 1. Contratos C2, C3 y C4

Con `P1` y `P2` creados en Catálogo (`POST /productos`) y `L` = un nodo cualquiera:

| Pedido | Respuesta obtenida |
|---|---|
| `PUT /stock/P1 {cantidad:10}` (C4: producto activo) | `200 {"productoId":"…a8","stock":10}` |
| `PUT /stock/65f1a2b3c4d5e6f7a8b9c0d1 {cantidad:5}` (no existe en Catálogo) | `404 {"error":"El producto … no existe en Catálogo","servicio":"inventario-service"}` |
| `PUT /stock/P3` con P3 dado de baja en Catálogo | `409 {"error":"El producto … está dado de baja en Catálogo", …}` |
| `PUT /stock/P1 {cantidad:-1}` | `400 {"error":"La \"cantidad\" debe ser un entero mayor o igual a 0", …}` |
| `POST /descuentos {referencia:"compra-1", items:[P1×2, P2×1]}` | `201 {"referencia":"compra-1","items":[…]}` |
| El mismo `POST` otra vez | `200` (mismo cuerpo, no descuenta de nuevo) |
| `POST /descuentos {referencia:"compra-2", items:[P1×1, P2×5]}` con P2 = 2 | `409 {"error":"Stock insuficiente", …, "faltantes":[{"productoId":"…ab","solicitado":5,"disponible":2}]}` y P1 no se tocó |
| `GET /stock?productoIds=P1,P2,noexiste1` | `200 [{P1, stock:8}, {P2, stock:2}, {noexiste1, stock:0}]` |
| `DELETE /descuentos/compra-1` (dos veces) | `204` y `204` |
| `DELETE /descuentos/compra-999` | `404 {"error":"No hay un descuento con la referencia compra-999", …}` |
| `GET /movimientos?productoId=P1` | `ALTA +10 → 10` · `DESCUENTO −2 → 8` · `REINTEGRO +2 → 10` |

## 2. Escrituras enviadas a un follower (D1)

```bash
curl -X PUT localhost:<follower>/stock/$P1 -H "Content-Type: application/json" -d '{"cantidad":20}'
curl -D - -o /dev/null "localhost:<follower>/stock?productoIds=$P1" | grep -i x-raft
```

`PUT`, `POST /descuentos`, `DELETE /descuentos` y un `409` por stock insuficiente enviados al
follower devolvieron la misma respuesta que el Leader (`200`, `201`, `204`, `409`). Ninguna
respuesta trae headers `X-Raft-*`.

## 3. Concurrencia

10 `POST /descuentos` simultáneos de 1 unidad sobre P1 (stock 20), alternando Leader y follower:
10 × `201` y `GET /stock` = **10** en los 3 nodos.

## 4. Failover del cluster (§12.2)

```bash
node scripts/estado-cluster.js          # Leader: inventario-3 (término 2)
# detener el proceso del Leader (Ctrl+C en su ventana, o docker compose stop inventario-3)
curl -X POST localhost:3201/descuentos -H "Content-Type: application/json" \
  -d '{"referencia":"failover-1","items":[{"productoId":"'$P1'","cantidad":1}]}'
```

| Momento | Resultado |
|---|---|
| Inmediatamente después de detener al Leader | `503 {"error":"Leader de Inventario no disponible: reintentá en unos segundos", …}` |
| A los 4 s | `201`; `inventario-1` es LEADER en el término 3 |
| `comparar-bases.js` con `inventario-3` caído | NO CONVERGEN (nodo3 en `lastApplied` 20, los otros en 22) |
| Se vuelve a levantar `inventario-3` | `comparar-bases.js` → **CONVERGEN** (los 3 en término 3, `lastApplied` 22) |

## 5. El Caso 2 del TP5, corregido (§12.3)

Nodos con `DESCUENTO_DELAY_MS=3000` y `LOCK_WAIT_MS=5000`:

```text
=== Orden A: el descuento empieza primero, el ajuste llega 1 s después
t=0s  PUT stock=10        [200]
t=0s  POST descuento 2    [201] termina a los 3.03s
t=1s  PUT stock=50        [200] esperó el lock: 2.00s
Stock final: 50
  #24 ALTA         10 -> stock 10
  #25 DESCUENTO    -2 -> stock 8
  #26 AJUSTE       42 -> stock 50
=== Orden B: el ajuste se confirma primero y después el descuento
PUT stock=50 [200]
POST descuento 2 [201]
Stock final: 48
```

En el TP4 el orden A terminaba en **8**: la reposición a 50 se perdía (ver
[`03-acoplamientos.md`](../03-acoplamientos.md), Caso 2).

## 6. Redis caído (§12.4)

| Situación | `POST /descuentos` | `GET /stock` | `GET /health` |
|---|---|---|---|
| Redis detenido | `503 {"error":"Redis no disponible: no se puede tomar el lock del producto", …}` en 0,037 s | `200` | `200` |
| Redis levantado de nuevo (sin reiniciar los nodos) | `201` | `200` | `200` |

## 7. Propiedad de datos

Colecciones de cada base (servidor Mongo local):

```text
inventario_nodo1  ["descuentos","movimientos","raft_estado","raft_log","stock"]
inventario_nodo2  ["descuentos","movimientos","raft_estado","raft_log","stock"]
inventario_nodo3  ["descuentos","movimientos","raft_estado","raft_log","stock"]
catalogo          ["productos"]
```

```bash
grep -rn "catalogo-db\|ventas-db" services/inventario     # sin resultados
grep -rnE "localhost|127\.0\.0\.1|mongodb://|redis://" services/inventario/src   # sin resultados
```

Inventario no conoce otras bases. Catálogo ya no tiene stock, y la única forma de cambiar el
stock desde afuera es pedirlo por C2/C3. La versión con `docker compose exec … mongosh` queda
para cuando el cluster esté integrado en Compose.

## Pendiente

- Evidencia de Docker (`docker --version`, `docker compose version`, `docker info`,
  `hello-world`) y build de la imagen: Docker Desktop no arrancaba en el equipo (WSL sin
  distribución instalada).
- Failover, propiedad de datos y configuración por entorno repetidos en Compose.
