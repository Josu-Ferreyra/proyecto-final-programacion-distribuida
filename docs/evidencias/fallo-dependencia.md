# Fallo de dependencia

**Objetivo:** demostrar que la caída de un servicio remoto produce un error controlado y
observable, que el servicio origen no se cae y que el caso de uso se recupera cuando la
dependencia vuelve (secciones 15.1 y 18 del TP). Responsable: Parte 3 · Matías Porcari.

Dependencias probadas: Ventas → Catálogo (C1), Ventas → Inventario (C3) y Ventas → su propia
base. El escenario C (solo el Leader de Inventario caído, el cluster oculta el fallo) es de
la Parte 2: [`inventario-pruebas.md`](./inventario-pruebas.md#4-failover-del-cluster-122) §4.

## Cómo repetirla

Con el entorno levantado y los datos de prueba cargados (`node scripts/seed.js`). `<id>` es
un producto activo de `scripts/.datos-prueba.json`.

```bash
# Escenario A — Catálogo detenido
docker compose stop catalogo-service
curl -i -X POST localhost:3300/compras -H "Content-Type: application/json" \
  -d '{"items":[{"productoId":"<id>","cantidad":1}]}'
docker compose ps ventas-service
docker compose logs ventas-service --tail 10
docker compose start catalogo-service       # esperar healthy y repetir la compra -> 201

# Escenario A' — Catálogo pausado
docker compose pause catalogo-service
curl -i -X POST localhost:3300/compras ...   # misma compra
docker compose unpause catalogo-service

# Escenario B — Inventario completo detenido, con una cancelación en curso
docker compose stop inventario-1 inventario-2 inventario-3
curl -i -X PATCH localhost:3300/compras/<compraId>/cancelar
docker compose start inventario-1 inventario-2 inventario-3
curl -s localhost:3300/compras/<compraId>    # en <= 30 s: CANCELADA

# Escenario D — Base propia de Ventas detenida
docker compose stop ventas-db
curl -i -X POST localhost:3300/compras ...
curl -s "localhost:3201/stock?productoIds=<id>"   # el stock no cambió
docker compose start ventas-db
```

## Salida obtenida

Corrida del 2026-10-22 sobre el entorno completo (logs de Ventas resumidos con `grep`).

### Escenario A · Catálogo detenido

```text
$ docker compose stop catalogo-service
 Container proyecto-distribuido-catalogo-service-1 Stopped
$ curl -i -X POST localhost:3300/compras -d '{"items":[{"productoId":"6ada816a0f67493ce363df94","cantidad":1}]}'
{"error":"Catálogo no disponible: no se pudo registrar la compra","servicio":"ventas-service","dependencia":"catalogo-service"}
HTTP 503 en 2.647318s
$ docker compose ps ventas-service
ventas-service Up 2 minutes (healthy)
$ curl -s 'localhost:3201/stock?productoIds=6ada816a0f67493ce363df94'
[{"productoId":"6ada816a0f67493ce363df94","stock":10}]
$ docker compose logs ventas-service
{"causa":"dns","dependencia":"catalogo-service","error":"ENOTFOUND","level":"error","message":"Dependencia no disponible","ms":2618,"operacion":"GET /productos","servicio":"ventas-service",...}
{"dependencia":"catalogo-service","error":"Catálogo no disponible: no se pudo registrar la compra","level":"error","message":"Request rechazada","operacion":"POST /compras","servicio":"ventas-service","status":503,...}
$ docker compose start catalogo-service
catalogo-service Up 6 seconds (healthy)
compra después de reiniciar Catálogo -> {"compraId":"6ada81d5c9b7c7f3001cf57d","estado":"CONFIRMADA",...}   (HTTP 201)
```

### Escenario A' · Catálogo pausado

```text
$ docker compose pause catalogo-service
$ curl -i -X POST localhost:3300/compras -d '{"items":[{"productoId":"6ada816a0f67493ce363df94","cantidad":1}]}'
{"error":"Catálogo no disponible: no se pudo registrar la compra","servicio":"ventas-service","dependencia":"catalogo-service"}
HTTP 503 en 3.008913s
$ docker compose logs ventas-service
{"causa":"timeout","dependencia":"catalogo-service","error":"The operation was aborted due to timeout","level":"error","message":"Dependencia no disponible","ms":3002,"operacion":"GET /productos","servicio":"ventas-service",...}
$ docker compose unpause catalogo-service
```

**¿Por qué una vez `dns` y otra `timeout`?** Un contenedor **detenido** se desconecta de la
red de Compose y su nombre desaparece del DNS interno: `catalogo-service` no resuelve y
`fetch` falla con `ENOTFOUND` (causa `dns`). Un contenedor **pausado** sigue conectado: el
nombre resuelve y la conexión TCP se abre, pero el proceso está congelado y nadie contesta,
así que la llamada corta por el timeout explícito de 3000 ms (causa `timeout`). Las dos
terminan en el mismo `503` para el cliente, pero el log indica la causa real.

### Escenario B · Inventario detenido con una cancelación en curso

```text
$ curl -s 'localhost:3201/stock?productoIds=6ada816a0f67493ce363df94'
[{"productoId":"6ada816a0f67493ce363df94","stock":9}]          <- la compra 6ada81d5… descontó 1
$ docker compose stop inventario-1 inventario-2 inventario-3
$ curl -i -X PATCH localhost:3300/compras/6ada81d5c9b7c7f3001cf57d/cancelar
{"compraId":"6ada81d5c9b7c7f3001cf57d","estado":"CANCELACION_PENDIENTE","mensaje":"Inventario no está disponible: el reintegro del stock se reintenta automáticamente"}
HTTP 202
$ curl -i -X POST localhost:3300/compras -d '{"items":[{"productoId":"6ada816a0f67493ce363df9e","cantidad":1}]}'
{"error":"Inventario no disponible: no se pudo registrar la compra","servicio":"ventas-service","dependencia":"inventario-service"}
HTTP 503 en 2.562786s
$ docker compose ps ventas-service
ventas-service Up 2 minutes (healthy)
$ docker compose start inventario-1 inventario-2 inventario-3
a los 9 s de reiniciar Inventario:
$ curl -s localhost:3300/compras/6ada81d5c9b7c7f3001cf57d
{"compraId":"6ada81d5c9b7c7f3001cf57d","estado":"CANCELADA","reintegroPendiente":false,...}
$ curl -s 'localhost:3201/stock?productoIds=6ada816a0f67493ce363df94'
[{"productoId":"6ada816a0f67493ce363df94","stock":10}]
$ docker compose logs ventas-service
{"causa":"dns","dependencia":"inventario-service","error":"ENOTFOUND","message":"Dependencia no disponible","operacion":"DELETE /descuentos/6ada81d5c9b7c7f3001cf57d",...}
{"compraId":"6ada81d5c9b7c7f3001cf57d","message":"Cancelación pendiente: Inventario no confirmó el reintegro","operacion":"compras.cancelar",...}
{"causa":"dns","dependencia":"inventario-service","message":"Dependencia no disponible","operacion":"POST /descuentos",...}
{"message":"Reintentando reintegros pendientes","operacion":"reintentos","pendientes":1,...}
{"compraId":"6ada81d5c9b7c7f3001cf57d","estado":"CANCELADA","message":"Reintegro completado","operacion":"reintentos",...}
```

La compra que se intentó con Inventario caído recibió `503` por conexión: el descuento no
llegó a Inventario, así que **no** hubo compensación ni compra guardada.

### Escenario D · Base de Ventas detenida

```text
$ docker compose stop ventas-db
$ curl -i -X POST localhost:3300/compras -d '{"items":[{"productoId":"6ada816a0f67493ce363df94","cantidad":1}]}'
{"error":"Base de datos no disponible","servicio":"ventas-service"}
HTTP 503 en 0.005918s
$ curl -s 'localhost:3201/stock?productoIds=6ada816a0f67493ce363df94'
[{"productoId":"6ada816a0f67493ce363df94","stock":10}]
$ docker compose ps ventas-service
ventas-service Up 2 minutes (healthy)
$ docker compose start ventas-db
compra después de reiniciar ventas-db -> {"compraId":"6ada81fdc9b7c7f3001cf58b","estado":"CONFIRMADA",...}   (HTTP 201)
```

Con su base caída, Ventas rechaza la compra **antes** de llamar a Catálogo o Inventario: no
tiene sentido descontar stock de una compra que después no se podría guardar.

## Resultado

| Escenario | Respuesta | ¿Ventas sigue vivo? | ¿Quedó algo a medias? | Recuperación |
|---|---|---|---|---|
| A · Catálogo detenido | `503`, causa `dns` | ✅ healthy | No | La compra vuelve a dar `201` al reiniciar Catálogo |
| A' · Catálogo pausado | `503` a los 3 s, causa `timeout` | ✅ | No | Al hacer `unpause` |
| B · Inventario detenido | Cancelación `202 CANCELACION_PENDIENTE`; compra `503` | ✅ healthy | Unidades descontadas hasta el reintento | `CANCELADA` y stock reintegrado 9 s después de levantar Inventario |
| D · `ventas-db` detenida | `503` inmediato | ✅ healthy | No (no se descontó stock) | La compra vuelve a dar `201` al reiniciar la base |

✅ Ninguna caída de una dependencia terminó en un `500` ni derribó a Ventas: cada fallo es un
`503` con el campo `dependencia` y queda en el log con la causa (`dns`, `timeout` o `conexion`).
