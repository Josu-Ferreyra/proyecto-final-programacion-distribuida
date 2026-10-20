# Startup y disponibilidad

**Objetivo:** los servicios esperan a su base (healthchecks y `depends_on` por salud) y
toleran que la base se caiga después: responden `503` sin colgarse ni reiniciarse, y vuelven
a funcionar solos cuando la base vuelve.

```bash
docker compose down
docker compose up -d
docker compose ps                     # mostrar "starting" → "healthy"

docker compose stop catalogo-db
curl -i http://localhost:3100/productos           # 503 inmediato
curl -i http://localhost:3100/health              # 200: el proceso sigue vivo
docker compose ps catalogo-service                # sigue "Up", sin reinicios
docker compose start catalogo-db
sleep 15
curl -i http://localhost:3100/productos           # 200 sin reiniciar el servicio
docker compose logs catalogo-service | grep -i mongodb
```

## Salida obtenida

_Pendiente de ejecutar._

**Resultado esperado:** `503 {"error":"Base de datos no disponible","servicio":"catalogo-service"}`
mientras la base está detenida; en los logs, `Conexión a MongoDB perdida` y después
`Conexión a MongoDB recuperada`.
