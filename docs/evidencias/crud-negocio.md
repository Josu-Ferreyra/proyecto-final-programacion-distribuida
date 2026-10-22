# CRUD / negocio — smoke test

**Objetivo:** demostrar que las operaciones principales siguen funcionando después de la
migración a microservicios, cruzando los tres servicios (sección 18 del TP). Responsable:
Parte 3 · Matías Porcari.

El smoke test ([`scripts/smoke-test.js`](../../scripts/smoke-test.js)) recorre cada caso de
uso con el código HTTP esperado en cada paso, usando solo las APIs públicas. Qué verifica
cada paso: [`scripts/README.md`](../../scripts/README.md#qué-verifica-el-smoke-test).

## Cómo repetirla

Desde la raíz del repositorio:

```bash
docker compose up --build -d
docker compose ps            # esperar a que los 9 contenedores estén "healthy"
node scripts/seed.js
node scripts/smoke-test.js   # código de salida 0 si todo da OK
```

## Salida obtenida

Corrida del 2026-10-22 sobre el entorno completo (Catálogo, los 3 nodos de Inventario,
Ventas, las tres bases y Redis), recién creado con `docker compose down -v` + `up --build -d`
+ `node scripts/seed.js`:

```text
$ node scripts/smoke-test.js

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
$ echo $?
0
```

**Resultado:** ✅ 23 de 23 pasos OK. El smoke test deja el stock como estaba (la compra de
prueba se cancela), así que se puede repetir tantas veces como haga falta.

Las respuestas de Ventas ante cada error de formato (items vacío, cantidad 0 o decimal,
producto repetido, JSON malformado, id de compra inválido) se probaron además contra los
mocks de `services/ventas/dev/mocks.js`: todas dan `400` con `{ error, servicio }`.
