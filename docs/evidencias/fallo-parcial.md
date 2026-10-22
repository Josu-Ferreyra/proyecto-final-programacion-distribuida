# Fallo parcial

**Objetivo:** reproducir el fallo parcial más delicado de "registrar una compra": Inventario
**no confirma a tiempo** un descuento que igual puede aplicarse después (secciones 15.3 y 18
del TP). Mostrar que Ventas compensa, qué estado queda en cada servicio y cómo se resuelve
solo. El análisis completo está en
[`12-comunicacion-y-fallos.md`](../12-comunicacion-y-fallos.md#124-análisis-de-fallo-parcial-registrar-una-compra).
Responsable: Parte 3 · Matías Porcari.

## Cómo repetirla

`DESCUENTO_DELAY_MS` (Parte 2) agrega una demora dentro del descuento de Inventario. Con 5000
ms, el descuento tarda más que el timeout de 3000 ms de Ventas.

```bash
# Inventario con el descuento demorado (recrea los 3 nodos con la variable)
DESCUENTO_DELAY_MS=5000 docker compose up -d inventario-1 inventario-2 inventario-3

# Caso 1 — C2 vence por timeout (<id> = "Monitor 24"" en scripts/.datos-prueba.json)
curl -i -X POST localhost:3300/compras -H "Content-Type: application/json" \
  -d '{"items":[{"productoId":"<id>","cantidad":2}]}'
curl -s localhost:3300/compras/<compraId>                 # FALLIDA, reintegroPendiente: true
curl -s "localhost:3201/movimientos?productoId=<id>"       # a los 5 s: DESCUENTO
# esperar <= 30 s (proceso de reintentos)
curl -s localhost:3300/compras/<compraId>                 # reintegroPendiente: false
curl -s "localhost:3201/movimientos?productoId=<id>"       # DESCUENTO y REINTEGRO, misma referencia

# Caso 2 — D7: la compensación también falla
curl -i -X POST localhost:3300/compras ... &   sleep 1;   docker compose pause inventario-1 inventario-2 inventario-3
curl -s localhost:3300/compras/<compraId>                 # FALLIDA, reintegroPendiente: true
docker compose unpause inventario-1 inventario-2 inventario-3
# esperar <= 30 s
curl -s localhost:3300/compras/<compraId>                 # reintegroPendiente: false

# Volver a Inventario sin demora
docker compose up -d inventario-1 inventario-2 inventario-3
```

> El `compose.yml` tiene que pasar `DESCUENTO_DELAY_MS: ${DESCUENTO_DELAY_MS:-0}` a los nodos
> de Inventario para que esta prueba funcione sin editar archivos.

## Salida obtenida

Corrida del 2026-10-22 sobre el entorno completo (respuestas y logs de Ventas resumidos).

### Caso 1 · C2 vence por timeout

```text
$ curl -s 'localhost:3201/stock?productoIds=6ada816a0f67493ce363df9e'
[{"productoId":"6ada816a0f67493ce363df9e","stock":10}]

$ curl -i -X POST localhost:3300/compras -d '{"items":[{"productoId":"6ada816a0f67493ce363df9e","cantidad":2}]}'
{"error":"Inventario no disponible: no se pudo registrar la compra","servicio":"ventas-service","dependencia":"inventario-service","compraId":"6ada8249c9b7c7f3001cf593","compensacion":"pendiente"}
HTTP 503 en 3.041410s

$ curl -s localhost:3300/compras/6ada8249c9b7c7f3001cf593
{"compraId":"6ada8249c9b7c7f3001cf593","estado":"FALLIDA","reintegroPendiente":true,"motivoFallo":"descuento sin confirmar (inventario-service no disponible (timeout)); el descuento todavía no figura en Inventario: se vuelve a verificar en el próximo reintento"}

-- 5 s después (el descuento atrasado ya se aplicó):
$ curl -s 'localhost:3201/stock?productoIds=6ada816a0f67493ce363df9e'
[{"productoId":"6ada816a0f67493ce363df9e","stock":8}]
$ curl -s 'localhost:3201/movimientos?productoId=6ada816a0f67493ce363df9e'   (solo los de esta referencia)
{"tipo":"DESCUENTO","cantidad":-2,"stockResultante":8,"referencia":"6ada8249c9b7c7f3001cf593","fecha":"2026-10-22T21:38:22.914Z"}

-- reintento de los 30 s (resuelto 18 s después):
$ curl -s localhost:3300/compras/6ada8249c9b7c7f3001cf593
{"compraId":"6ada8249c9b7c7f3001cf593","estado":"FALLIDA","reintegroPendiente":false,...}
$ curl -s 'localhost:3201/stock?productoIds=6ada816a0f67493ce363df9e'
[{"productoId":"6ada816a0f67493ce363df9e","stock":10}]
$ curl -s 'localhost:3201/movimientos?productoId=6ada816a0f67493ce363df9e'   (solo los de esta referencia)
{"tipo":"DESCUENTO","cantidad":-2,"stockResultante":8,"referencia":"6ada8249c9b7c7f3001cf593","fecha":"2026-10-22T21:38:22.914Z"}
{"tipo":"REINTEGRO","cantidad":2,"stockResultante":10,"referencia":"6ada8249c9b7c7f3001cf593","fecha":"2026-10-22T21:38:43.765Z"}

$ docker compose logs ventas-service
21:38:20.813 error Dependencia no disponible {"causa":"timeout","dependencia":"inventario-service","ms":3001,"operacion":"POST /descuentos"}
             warn  Compensación pendiente {"compraId":"6ada8249c9b7c7f3001cf593","detalle":"el descuento todavía no figura en Inventario: se vuelve a verificar en el próximo reintento","operacion":"compensacion"}
21:38:20.836 error Request rechazada {"operacion":"POST /compras","status":503,"compensacion":"pendiente","compraId":"6ada8249c9b7c7f3001cf593"}
21:38:43.759 info  Reintentando reintegros pendientes {"operacion":"reintentos","pendientes":1}
21:38:43.799 info  Reintegro completado {"compraId":"6ada8249c9b7c7f3001cf593","estado":"FALLIDA","operacion":"reintentos"}
```

**Lo que muestra este caso:** Ventas cortó a los 3 s y pidió el reintegro (C3) enseguida.
Inventario respondió `404`, porque el descuento todavía estaba esperando su demora y no
existía. **Dos segundos después el descuento se aplicó igual** (stock 8). Si ese `404` se
hubiera tomado como "no había nada que reintegrar", esas 2 unidades habrían quedado
descontadas sin compra para siempre. Ventas no lo toma como definitivo después de un timeout:
guarda la compra `FALLIDA` con `reintegroPendiente: true`, y el reintento encontró el
descuento atrasado y lo revirtió (stock 10). Ver §12.4 del análisis.

### Caso 2 · D7: además la compensación falla

```text
$ curl -i -X POST localhost:3300/compras ... &   ; sleep 1 ; docker compose pause inventario-1 inventario-2 inventario-3
{"error":"Inventario no disponible: no se pudo registrar la compra","servicio":"ventas-service","dependencia":"inventario-service","compraId":"6ada8266c9b7c7f3001cf5a3","compensacion":"pendiente"}
HTTP 503 en 6.021607s

$ curl -s localhost:3300/compras/6ada8266c9b7c7f3001cf5a3
{"compraId":"6ada8266c9b7c7f3001cf5a3","estado":"FALLIDA","reintegroPendiente":true,"motivoFallo":"descuento sin confirmar (inventario-service no disponible (timeout)); el reintegro no se pudo confirmar (inventario-service no disponible (timeout))"}

$ docker compose unpause inventario-1 inventario-2 inventario-3
-- reintento (resuelto 22 s después):
$ curl -s localhost:3300/compras/6ada8266c9b7c7f3001cf5a3
{"compraId":"6ada8266c9b7c7f3001cf5a3","estado":"FALLIDA","reintegroPendiente":false,...}
$ curl -s 'localhost:3201/stock?productoIds=6ada816a0f67493ce363df9e'
[{"productoId":"6ada816a0f67493ce363df9e","stock":10}]

$ docker compose logs ventas-service
21:38:49.110 error Dependencia no disponible {"causa":"timeout","dependencia":"inventario-service","ms":3002,"operacion":"POST /descuentos"}
21:38:52.112 error Dependencia no disponible {"causa":"timeout","dependencia":"inventario-service","ms":3002,"operacion":"DELETE /descuentos/6ada8266c9b7c7f3001cf5a3"}
             warn  Compensación pendiente {"compraId":"6ada8266c9b7c7f3001cf5a3","detalle":"el reintegro no se pudo confirmar (inventario-service no disponible (timeout))"}
21:38:52.115 error Request rechazada {"operacion":"POST /compras","status":503,"compensacion":"pendiente"}
21:39:13.761 info  Reintentando reintegros pendientes {"operacion":"reintentos","pendientes":1}
21:39:13.778 info  Reintegro completado {"compraId":"6ada8266c9b7c7f3001cf5a3","estado":"FALLIDA","operacion":"reintentos"}
```

C2 y C3 vencieron por timeout (6 s en total): Ventas no puede saber si el descuento se
aplicó, así que deja la compra `FALLIDA` con el reintegro pendiente (D7). En esta corrida el
descuento **no** llegó a aplicarse: al congelar los 3 nodos el Leader perdió el liderazgo y la
entrada se descartó. Por eso no hay movimientos con esa referencia y el reintento recibió
`404`, que esta vez sí es definitivo (el descuento ya no está en camino). Cualquiera de los
dos desenlaces termina con el stock en 10.

## Resultado

| Caso | Respuesta al cliente | Estado intermedio | Estado final |
|---|---|---|---|
| 1 · timeout de C2 | `503` en 3 s, `compensacion: "pendiente"` | Stock descontado sin compra (8) + compra `FALLIDA` con reintegro pendiente | Stock reintegrado (10), compra `FALLIDA` sin pendientes, movimientos `DESCUENTO` y `REINTEGRO` con la misma referencia |
| 2 · timeout de C2 y de C3 (D7) | `503` en 6 s, `compensacion: "pendiente"` | Compra `FALLIDA` con reintegro pendiente | Reintegro confirmado al volver Inventario; stock 10 |

✅ En los dos casos el sistema pasa por un estado temporalmente inconsistente, lo registra y
lo resuelve solo, sin intervención manual.
