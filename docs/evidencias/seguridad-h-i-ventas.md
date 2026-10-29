# Evidencia · H e I en Ventas — Propiedad de la compra

**Objetivo (TP7 §19 escenarios H e I, y §11.2):** un cliente autenticado no puede consultar ni cancelar la
compra de otro (`403`); el dueño y un `ADMIN` sí (`200`).

Corrida del 28/10/2026 con la solución completa en Docker Compose (11 contenedores `healthy`):
`main` más los PRs del TP7 de auth-service, Catálogo y Compose (Parte 1), Inventario (Parte 2) y
Ventas, seed y smoke test (Parte 3). Datos cargados con `node scripts/seed.js` (ADMIN y los clientes
`cliente1` y `cliente2`, ver [`scripts/README.md`](../../scripts/README.md)). Ningún token aparece
completo: los scripts los usan sin imprimirlos.

```bash
cp .env.example .env              # completar JWT_SECRET, ADMIN_PASSWORD y VENTAS_SERVICE_PASSWORD
docker compose up --build -d
node scripts/seed.js
node scripts/smoke-test.js
```

```text
  OK    Los rechazos no tocaron el stock
6. Ventas: propiedad de la compra, trazabilidad y cancelación (C3)
  OK    cliente1 consulta su compra (200)
  OK    cliente2 NO puede consultar la compra de cliente1 (403)
  OK    ADMIN consulta la compra de cliente1 (200)
  OK    cliente2 NO puede cancelar la compra de cliente1 (403)
  OK    El rechazo no tocó el stock
  OK    cliente1 cancela su compra (200)
  OK    Cancelar otra vez (409)
```

| Situación | Esperado | Obtenido |
|---|---|---|
| `cliente1` consulta y cancela su compra | 200 | ✅ |
| `cliente2` consulta la compra de `cliente1` | 403 | ✅ |
| `cliente2` intenta cancelarla (y el stock no cambia) | 403 | ✅ |
| `ADMIN` consulta la compra de `cliente1` | 200 | ✅ |
| Compra sin token | 401 | ✅ |
| Token de la cuenta técnica (`SERVICIO`) | 403 | ✅ |

Salida completa del smoke test (38 OK, 0 FAIL):

```text

1. Salud de los servicios
  OK    auth-service /health (200)
  OK    Catálogo /health (200)
  OK    Inventario http://localhost:3201 /health (200)
  OK    Inventario http://localhost:3202 /health (200)
  OK    Inventario http://localhost:3203 /health (200)
  OK    Ventas /health (200)

2. Autenticación (auth-service)
  OK    Login de admin
  OK    Login de cliente1
  OK    Login de cliente2
  OK    Login con password incorrecta (401)

3. Catálogo: alta, consulta, modificación y baja lógica (ADMIN)
  OK    Crear producto sin token (401)
  OK    Crear producto con un CLIENTE (403)
  OK    Crear producto con ADMIN (201)
  OK    Leer producto (público) (200)
  OK    Modificar precio (200)
  OK    Rechazar stock en Catálogo (400)
  OK    Dar de baja (lógica) (204)
  OK    Sigue existiendo, inactivo (200)

4. Inventario: disponibilidad y quién puede mover stock
  OK    Consultar stock del teclado (público) (200)
  OK    Un CLIENTE no puede descontar stock directo en Inventario (403)
  OK    Un CLIENTE no puede ajustar stock (403)

5. Ventas: registrar compras (C1 + C2 con la cuenta de servicio)
  OK    Comprar sin token (401)
  OK    cliente1 compra 1 teclado (201)
  OK    El stock bajó 1 unidad
  OK    Comprar más unidades de las que hay (409)
  OK    Comprar un producto inexistente (400)
  OK    Comprar el producto dado de baja (409)
  OK    Los rechazos no tocaron el stock

6. Ventas: propiedad de la compra, trazabilidad y cancelación (C3)
  OK    cliente1 consulta su compra (200)
  OK    cliente2 NO puede consultar la compra de cliente1 (403)
  OK    ADMIN consulta la compra de cliente1 (200)
  OK    Inventario registró el DESCUENTO con referencia = compraId
  OK    El DESCUENTO guarda el usuarioId de cliente1 (contexto propagado por Ventas)
  OK    cliente2 NO puede cancelar la compra de cliente1 (403)
  OK    El rechazo no tocó el stock
  OK    cliente1 cancela su compra (200)
  OK    El stock volvió al valor inicial
  OK    Cancelar otra vez (409)

38 OK, 0 FAIL
```
