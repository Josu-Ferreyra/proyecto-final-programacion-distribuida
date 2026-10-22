# Datos de prueba

**Objetivo:** demostrar que existe un procedimiento reproducible para preparar un estado
inicial conocido (sección 18 y entregable 13 del TP), cargado solo por las APIs. Responsable:
Parte 3 · Matías Porcari. Detalle de los scripts: [`scripts/README.md`](../../scripts/README.md).

## Cómo repetirla

Desde la raíz del repositorio:

```bash
docker compose down -v          # borra los volúmenes: laboratorio vacío
docker compose up --build -d
docker compose ps               # esperar a que los 9 contenedores estén "healthy"
node scripts/seed.js
node scripts/seed.js            # segunda vez: tiene que dejar el mismo estado
node scripts/smoke-test.js
```

## Salida obtenida

Corrida del 2026-10-22.

```text
$ docker compose down -v
 Volume proyecto-distribuido_ventas-data Removed
 Volume proyecto-distribuido_inventario-data Removed
 Volume proyecto-distribuido_catalogo-data Removed
 Network proyecto-distribuido_backend Removed

$ docker compose up --build -d
$ docker compose ps --format "table {{.Service}}\t{{.Status}}"
SERVICE            STATUS
catalogo-db        Up 19 seconds (healthy)
catalogo-service   Up 12 seconds (healthy)
inventario-1       Up 8 seconds (healthy)
inventario-2       Up 8 seconds (healthy)
inventario-3       Up 8 seconds (healthy)
inventario-db      Up 19 seconds (healthy)
redis              Up 19 seconds (healthy)
ventas-db          Up 19 seconds (healthy)
ventas-service     Up 12 seconds (healthy)

$ node scripts/seed.js
Catálogo: http://localhost:3100 · Inventario: http://localhost:3201
┌─────────┬───────────┬────────────────────────────┬─────────────────────────┬────────┬───────┬────────┐
│ (index) │ clave     │ id                         │ nombre                  │ precio │ stock │ activo │
├─────────┼───────────┼────────────────────────────┼─────────────────────────┼────────┼───────┼────────┤
│ 0       │ 'teclado' │ '6ada82b562c830c879f1f023' │ 'Teclado mecánico'      │ 25000  │ 10    │ true   │
│ 1       │ 'mouse'   │ '6ada82b562c830c879f1f028' │ 'Mouse inalámbrico'     │ 12000  │ 10    │ true   │
│ 2       │ 'monitor' │ '6ada82b562c830c879f1f02d' │ 'Monitor 24"'           │ 90000  │ 10    │ true   │
│ 3       │ 'baja'    │ '6ada82b562c830c879f1f032' │ 'Producto dado de baja' │ 1000   │ 5     │ false  │
└─────────┴───────────┴────────────────────────────┴─────────────────────────┴────────┴───────┴────────┘
Ids guardados en scripts\.datos-prueba.json

$ node scripts/seed.js   (segunda vez)
│ 0       │ 'teclado' │ '6ada82b562c830c879f1f023' │ 'Teclado mecánico'      │ 25000  │ 10    │ true   │
│ 1       │ 'mouse'   │ '6ada82b562c830c879f1f028' │ 'Mouse inalámbrico'     │ 12000  │ 10    │ true   │
│ 2       │ 'monitor' │ '6ada82b562c830c879f1f02d' │ 'Monitor 24"'           │ 90000  │ 10    │ true   │
│ 3       │ 'baja'    │ '6ada82b562c830c879f1f032' │ 'Producto dado de baja' │ 1000   │ 5     │ false  │

$ node scripts/smoke-test.js
...
23 OK, 0 FAIL
```

La salida completa del smoke test está en [`crud-negocio.md`](./crud-negocio.md).

## Qué muestra

- Desde un laboratorio vacío (`down -v`), un solo comando deja **4 productos** en Catálogo
  (uno dado de baja) y su stock en Inventario.
- La segunda corrida devuelve **los mismos ids y el mismo stock**: el seed reutiliza lo que
  existe y vuelve a fijar los valores conocidos.
- Todo se carga por las APIs (`POST /productos`, `PUT /stock/:productoId`, `DELETE
  /productos/:id`): el script no se conecta a ninguna base. Inventario validó cada producto
  contra Catálogo (C4) antes de darle stock.
- El estado queda listo para las demás pruebas: el smoke test da 23 OK.

**Resultado:** ✅ procedimiento reproducible e idempotente para el estado inicial.
