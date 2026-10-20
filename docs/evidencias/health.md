# Health checks

**Objetivo:** cada servicio (y cada nodo de Inventario) responde `GET /health` sin exponer
secretos ni URIs.

```bash
curl http://localhost:3100/health    # catalogo-service
curl http://localhost:3201/health    # inventario-1
curl http://localhost:3202/health    # inventario-2
curl http://localhost:3203/health    # inventario-3
curl http://localhost:3300/health    # ventas-service
docker inspect --format '{{.Name}} {{.State.Health.Status}}' $(docker compose ps -q)
```

## Salida obtenida

_Pendiente de ejecutar._

**Resultado esperado:** `200 {"service":"<nombre>","status":"ok"}` (los nodos de Inventario
agregan `"nodo"`), y `healthy` en todos los contenedores.
