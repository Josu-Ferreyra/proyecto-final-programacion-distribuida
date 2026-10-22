# Comunicación entre microservicios

**Objetivo:** mostrar que al menos dos microservicios intercambian información por HTTP
cuando el caso de uso lo requiere (sección 18 del TP). Caso: **registrar una compra**, que
usa C1 (Ventas → Catálogo) y C2 (Ventas → Inventario). Responsable: Parte 3 · Matías
Porcari.

## Cómo repetirla

Con el entorno levantado y los datos de prueba cargados (`node scripts/seed.js`), en una
terminal se dejan corriendo los logs y en otra se hace la compra:

```bash
docker compose logs -f ventas-service catalogo-service inventario-1 inventario-2 inventario-3
```

```bash
# <id> = id del "Mouse inalámbrico" en scripts/.datos-prueba.json
curl -s -X POST localhost:3300/compras -H "Content-Type: application/json" \
  -d '{"items":[{"productoId":"<id>","cantidad":2}]}'
curl -s "localhost:3201/movimientos?productoId=<id>"
```

## Salida obtenida

Corrida del 2026-10-22.

```text
$ curl -s -X POST localhost:3300/compras -H 'Content-Type: application/json' \
    -d '{"items":[{"productoId":"6ada816a0f67493ce363df99","cantidad":2}]}'
{
  "compraId": "6ada81a6c9b7c7f3001cf577",
  "estado": "CONFIRMADA",
  "reintegroPendiente": false,
  "items": [
    {
      "productoId": "6ada816a0f67493ce363df99",
      "nombreProducto": "Mouse inalámbrico",
      "precioUnitario": 12000,
      "cantidad": 2
    }
  ],
  "total": 24000,
  "fecha": "2026-10-22T21:35:34.712Z",
  "actualizada": "2026-10-22T21:35:34.712Z"
}
```

Logs de los cinco contenedores durante esa compra, ordenados por hora (`docker compose
logs`, filtrados por la compra y resumidos a hora, servicio, mensaje y campos):

```text
21:35:34.561 catalogo-service Request {"method":"GET","ms":7,"status":200,"url":"/productos?ids=6ada816a0f67493ce363df99"}
21:35:34.653 inventario-1     Propongo descuento de stock {"items":[{"cantidad":2,"productoId":"6ada816a0f67493ce363df99"}],"operacion":"DESCONTAR","referencia":"6ada81a6c9b7c7f3001cf577"}
21:35:34.657 inventario-1     Entrada agregada al log local del Leader (todavía no replicada ni committed) {"index":12,"tipo":"DESCONTAR"}
21:35:34.674 inventario-1     Commit avanzado por mayoría {"desde":12,"hasta":12,"replicas":"2/3"}
21:35:34.688 inventario-1     Entrada aplicada a la State Machine {"index":12,"tipo":"DESCONTAR"}
21:35:34.691 inventario-1     Request {"ms":47,"operacion":"POST /descuentos","status":201}
21:35:34.706 inventario-2     Escritura reenviada al Leader {"leader":"inventario-1","operacion":"POST /descuentos","status":201}
21:35:34.708 inventario-2     Request {"ms":140,"operacion":"POST /descuentos","status":201}
21:35:34.721 ventas-service   Compra confirmada {"compraId":"6ada81a6c9b7c7f3001cf577","items":1,"operacion":"compras.registrar","total":24000}
21:35:34.766 inventario-2     Commit avanzado (informado por el Leader) {"desde":12,"hasta":12,"leaderCommit":12}
21:35:34.766 inventario-3     Commit avanzado (informado por el Leader) {"desde":12,"hasta":12,"leaderCommit":12}
21:35:34.782 inventario-3     Entrada aplicada a la State Machine {"index":12,"tipo":"DESCONTAR"}
21:35:34.784 inventario-2     Entrada aplicada a la State Machine {"index":12,"tipo":"DESCONTAR"}
```

```text
$ curl -s "localhost:3201/movimientos?productoId=6ada816a0f67493ce363df99"
[{"productoId":"6ada816a0f67493ce363df99","indiceRaft":3,"cantidad":10,"stockResultante":10,"tipo":"ALTA",...},
 {"productoId":"6ada816a0f67493ce363df99","indiceRaft":7,"cantidad":0,"stockResultante":10,"tipo":"AJUSTE",...},
 {"productoId":"6ada816a0f67493ce363df99","indiceRaft":12,"cantidad":-2,"referencia":"6ada81a6c9b7c7f3001cf577","stockResultante":8,"tipo":"DESCUENTO",...}]
```

(El `AJUSTE` de 0 unidades es la segunda corrida del seed, que vuelve a fijar el stock en 10.)

## Qué muestra

| Momento | Qué se ve |
|---|---|
| C1 | Catálogo recibe `GET /productos?ids=…` de Ventas y responde 200: Ventas obtiene nombre, precio y estado sin leer la base de Catálogo |
| C2 | Ventas llama a `inventario-service`. El alias DNS lo resolvió `inventario-2`, que es follower, y **reenvió** el pedido al Leader `inventario-1` (decisión D1): Ventas no sabe cuál es el Leader |
| Inventario decide | El Leader propone el descuento a Raft; se confirma con mayoría 2/3 y se aplica en los 3 nodos |
| Ventas registra | Recién con el 201 de Inventario, Ventas guarda la compra `CONFIRMADA` con el precio pagado (12000) y el total (24000) |
| Trazabilidad | El movimiento `DESCUENTO` de Inventario tiene `referencia` = `compraId` de Ventas: se puede seguir la operación entre servicios |

**Resultado:** ✅ Ventas, Catálogo e Inventario intercambian información por HTTP en una
compra, cada uno modificando solo sus propios datos.
