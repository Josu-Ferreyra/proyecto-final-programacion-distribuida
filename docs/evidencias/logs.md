# Logs

**Objetivo:** los logs de cada servicio salen por stdout y cada línea indica servicio,
nivel, operación y, si corresponde, el error.

```bash
docker compose logs --tail 20
docker compose logs catalogo-service
docker compose logs -f catalogo-service &
curl http://localhost:3100/productos/65f1a2b3c4d5e6f7a8b9c0d1          # 404
curl -X POST http://localhost:3100/productos -H "Content-Type: application/json" \
  -d '{"nombre":"Duplicado","precio":10}'
curl -X POST http://localhost:3100/productos -H "Content-Type: application/json" \
  -d '{"nombre":"Duplicado","precio":10}'                                # 409
docker compose logs -f ventas-service       # con Ventas levantado: provocar un 404 y un 409
```

## Salida obtenida

_Pendiente de ejecutar._

**Resultado esperado:** líneas JSON con `servicio`, `level`, `operacion` (por ejemplo
`GET /productos/65f1…`), `status` y `error`.
