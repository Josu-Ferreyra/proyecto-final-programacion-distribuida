# Inicio con Docker Compose

**Objetivo:** desde un clon limpio, un solo comando levanta todo y cada contenedor llega a
`healthy`.

```bash
git clone <repo> tp6-limpio && cd tp6-limpio
docker compose config --quiet && echo "compose.yml válido"
docker compose up --build -d
docker compose ps
```

## Salida obtenida

_Pendiente de ejecutar._

**Resultado esperado:** en `docker compose ps`, las bases, Redis y los servicios en estado
`running (healthy)`, y solo los puertos 3100, 3201–3203 y 3300 publicados.
