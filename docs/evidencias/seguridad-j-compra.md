# Evidencia · J — Caso de uso que atraviesa los servicios

**Objetivo (TP7 §19, escenario J):** una compra atraviesa Ventas, Catálogo e Inventario y el contexto de
identidad se conserva según la estrategia documentada (D13, [`docs/17-propagacion-identidad.md`](../17-propagacion-identidad.md)):
Ventas valida el token del cliente, llama a Inventario con su token de servicio y le pasa el
`usuarioId` del cliente.

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

## Smoke test (secciones de Ventas)

```text
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

Lo que demuestra: la compra queda a nombre del `sub` de `cliente1`, y el movimiento `DESCUENTO` que
guarda Inventario tiene **el mismo** `usuarioId`, aunque Inventario recibió el token de la cuenta
técnica y no el del cliente.

## El mismo pedido en los logs de Ventas e Inventario

```bash
docker compose logs ventas-service | grep <compraId>
docker compose logs inventario-1 inventario-2 inventario-3 | grep <compraId>
```

```text
{"compraId":"6ae2a515f94a1d06a0a1c29e","items":1,"level":"info","message":"Compra confirmada","operacion":"compras.registrar","servicio":"ventas-service","timestamp":"2026-10-29T01:44:53.324Z","total":25000,"usuarioId":"6ae2a4f699ba1f0a8a1c0ab3"}
{"items":[{"cantidad":1,"productoId":"6ae2a4f5e2eafd5934be2330"}],"level":"info","message":"Propongo descuento de stock","nodo":"inventario-1","operacion":"DESCONTAR","referencia":"6ae2a515f94a1d06a0a1c29e","servicio":"inventario-service","timestamp":"2026-10-29T01:44:53.307Z","usuarioId":"6ae2a4f699ba1f0a8a1c0ab3"}
{"level":"info","message":"Token de servicio obtenido","operacion":"authClient.login","servicio":"ventas-service","timestamp":"2026-10-29T01:44:24.770Z","venceEn":900}
```

El `usuarioId` es el mismo en los dos servicios. Ventas pidió su token de servicio una sola vez y lo
reusa (caché). Ningún log contiene un token:

```bash
docker compose logs ventas-service inventario-1 inventario-2 inventario-3 auth-service catalogo-service | grep -c "eyJ"     # 0
```

## Extras

| Prueba | Resultado |
|---|---|
| `POST /compras` con `"usuarioId": "otro-usuario"` en el body | `201` y la compra queda con el `sub` de `cliente1`: el body se ignora |
| `POST /compras` con un token `SERVICIO` | `403 "Permisos insuficientes"`: la cuenta técnica no compra |
| `POST /descuentos` directo a Inventario con un token `CLIENTE` | `403` (smoke test, sección 4) |
