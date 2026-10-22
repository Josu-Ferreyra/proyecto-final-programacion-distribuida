# Datos de prueba y smoke test

Scripts de la Parte 3 del TP6 (entregable 13 y prueba "CRUD / negocio" de la sección 18).
Usan **solo las APIs públicas** de Catálogo, Inventario y Ventas: nunca escriben en una
base. Requieren Node.js 18 o superior y no tienen dependencias (no hace falta `npm install`).

| Script | Qué hace |
|---|---|
| `seed.js` | Deja un estado inicial conocido: 4 productos en Catálogo y su stock en Inventario. Guarda los ids en `scripts/.datos-prueba.json` |
| `generar-evidencias.js` | Corre las pruebas obligatorias contra el entorno levantado y guarda comandos + salida real en `docs/evidencias/` (`lista` muestra las disponibles, `parte1` regenera las de Compose, `--sobrescribir` pisa un archivo existente) |
| `verificar-entrega.js` | Controles de la sección 21 sin Docker: archivos de cada servicio, `.dockerignore`, `compose.yml`, secretos y basura versionados, README, vínculos entre documentos, evidencias, tags y autores. Termina con código 1 si falla algo |
| `smoke-test.js` | Recorre los casos de uso de punta a punta con el código esperado en cada paso y termina con `N OK, M FAIL` (código de salida 1 si algo falla) |

## Qué carga el seed

Los mismos 3 productos del seed del TP4 (`app-base/scripts/seed.js`), más uno dado de baja
para poder probar que Ventas no vende productos inactivos:

| Producto | Precio | Categoría | Stock | Estado |
|---|---|---|---|---|
| Teclado mecánico | 25000 | periferico | 10 | activo |
| Mouse inalámbrico | 12000 | periferico | 10 | activo |
| Monitor 24" | 90000 | monitor | 10 | activo |
| Producto dado de baja | 1000 | otro | 5 | dado de baja |

Cómo lo carga:

1. Espera a que Catálogo e Inventario respondan `/health` (hasta 90 s, útil justo después de
   `docker compose up`).
2. Busca cada producto por nombre (`GET /productos?nombreContiene=`). Si no existe lo crea
   (`POST /productos`); si existe, le vuelve a poner el precio y la categoría de la tabla.
3. Fija el stock con `PUT /stock/:productoId` (Inventario consulta a Catálogo por C4 la
   primera vez). Si Inventario está eligiendo Leader responde `503`: se reintenta.
4. Da de baja el último producto (`DELETE /productos/:id`, baja lógica). El stock se fija
   **antes** de la baja, porque C4 rechaza el alta de stock de un producto inactivo.

**Es idempotente:** correrlo dos veces deja el mismo estado y los mismos ids. Los ids los
genera Catálogo, por eso se guardan en `.datos-prueba.json` (no se versiona).

## Cómo correrlo

### Con Docker Compose

Desde la raíz del repositorio. Los valores por defecto ya apuntan a los puertos publicados:

```bash
docker compose up --build -d
docker compose ps                  # esperar a que todo esté "healthy"
node scripts/seed.js
node scripts/smoke-test.js
```

### Local (`npm start`)

Con Catálogo, los 3 nodos de Inventario y Ventas corriendo en sus puertos locales (3100,
3201–3203 y 3300), los mismos comandos funcionan sin cambios: la convención de puertos es
la misma en los dos modos. Para apuntar a otras direcciones:

| Variable | Por defecto | Usada por |
|---|---|---|
| `CATALOGO_URL` | `http://localhost:3100` | los dos |
| `INVENTARIO_URL` | `http://localhost:3201` | los dos (cualquier nodo: los followers reenvían las escrituras al Leader) |
| `VENTAS_URL` | `http://localhost:3300` | `smoke-test.js` |
| `INVENTARIO_NODOS` | `http://localhost:3201,http://localhost:3202,http://localhost:3203` | `smoke-test.js` (chequeo de `/health` de cada nodo) |

```bash
CATALOGO_URL=http://localhost:3100 node scripts/seed.js
# PowerShell: $env:CATALOGO_URL='http://localhost:3100'; node scripts/seed.js
```

## Reiniciar desde cero

```bash
docker compose down -v             # borra los volúmenes: catálogo, stock y compras
docker compose up --build -d
node scripts/seed.js
```

`docker compose down` (sin `-v`) conserva los datos. En modo local, para empezar de cero se
borran las bases `catalogo`, `inventario_nodo1..3` y `ventas` del MongoDB local
(`mongosh --eval "db.getSiblingDB('ventas').dropDatabase()"`, etc.) y se vuelve a correr el
seed.

## Qué verifica el smoke test

| Paso | Esperado |
|---|---|
| `GET /health` de Catálogo, de los 3 nodos de Inventario y de Ventas | `200` |
| Crear, leer, modificar y dar de baja un producto en Catálogo | `201`, `200`, `200`, `204`, y el producto sigue existiendo con `activo: false` |
| `PUT /productos/:id` con `stock` | `400` (el stock es de Inventario) |
| `GET /stock?productoIds=…` | `200` |
| Compra de 1 teclado | `201 CONFIRMADA` con el total correcto, y el stock baja 1 |
| Compra de más unidades de las que hay | `409 { faltantes }` |
| Compra de un id inexistente | `400 { productosInexistentes }` |
| Compra del producto dado de baja | `409 { productosInactivos }` |
| Los tres rechazos | no cambian el stock |
| `GET /compras/:id` | `200` con el nombre y el precio pagado |
| `GET /movimientos?productoId=…` | hay un `DESCUENTO` con `referencia` = `compraId` |
| Cancelar la compra | `200 CANCELADA`, y el stock vuelve al valor inicial |
| Cancelar otra vez | `409` |

Deja el stock como estaba. Cada corrida crea un producto `Producto smoke test <fecha>` que
queda dado de baja en Catálogo: no afecta al seed ni a las ventas.
