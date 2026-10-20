# Persistencia con volúmenes

**Objetivo:** los datos sobreviven a `docker compose down` (sin `-v`) porque viven en
volúmenes con nombre.

```bash
curl -X POST http://localhost:3100/productos -H "Content-Type: application/json" \
  -d '{"nombre":"Prueba persistencia","precio":1000,"categoria":"otro"}'
curl "http://localhost:3100/productos?nombreContiene=persistencia"
docker compose down
docker volume ls --filter name=proyecto-distribuido
docker compose up -d
docker compose ps                     # esperar "healthy"
curl "http://localhost:3100/productos?nombreContiene=persistencia"
```

## Salida obtenida

_Pendiente de ejecutar._

**Resultado esperado:** el producto aparece antes y después del `down`/`up`, con el mismo
`id`, y `docker volume ls` muestra `proyecto-distribuido_catalogo-data`,
`proyecto-distribuido_inventario-data` y `proyecto-distribuido_ventas-data`.
