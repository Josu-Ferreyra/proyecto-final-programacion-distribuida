# 13. Pruebas y evidencias

> Corresponde a la sección 18 del TP6 (entregable 11). Índice: Parte 1 · Josué Ferreyra.
> Cada responsable agrega su evidencia en [`evidencias/`](./evidencias/).

Cada evidencia tiene el **objetivo**, los **comandos exactos**, la **salida obtenida** y, si
hace falta, una captura. Las capturas solas no alcanzan: la prueba tiene que poder
repetirse desde un clon limpio con los comandos del archivo.

Antes de empezar, desde la raíz del repositorio:

```bash
docker compose down -v          # laboratorio limpio (borra los datos)
docker compose up --build -d
docker compose ps               # esperar a que todo esté "healthy"
node scripts/seed.js            # datos de prueba (Parte 3)
```

| Prueba (sección 18) | Responsable | Evidencia | Comando para repetirla | Estado |
|---|---|---|---|---|
| Docker instalado (cada integrante) | Los tres | [`docker-ferreyra.md`](./evidencias/docker-ferreyra.md) · [`docker-vicente.md`](./evidencias/docker-vicente.md) · [`docker-porcari.md`](./evidencias/docker-porcari.md) | `docker run --rm hello-world` | ok (los tres) |
| Build individual | Parte 1 | [`build-individual.md`](./evidencias/build-individual.md) | `docker build -t grupo/<svc>:tp6 ./services/<svc>` | Catálogo ok · falta Inventario y Ventas |
| Inicio con Compose | Parte 1 | [`compose-up.md`](./evidencias/compose-up.md) | `docker compose up --build -d` | Catálogo ok · falta Inventario y Ventas |
| Health | Parte 1 | [`health.md`](./evidencias/health.md) | `curl localhost:<puerto>/health` | Catálogo ok · falta Inventario y Ventas |
| CRUD / negocio | Parte 3 | [`crud-negocio.md`](./evidencias/crud-negocio.md) | `node scripts/smoke-test.js` | ok |
| Comunicación | Parte 3 | [`comunicacion.md`](./evidencias/comunicacion.md) | ver [`12-comunicacion-y-fallos.md`](./12-comunicacion-y-fallos.md) | ok |
| Propiedad de datos | Parte 2 | [`inventario-pruebas.md` §7](./evidencias/inventario-pruebas.md#7-propiedad-de-datos) | `mongosh … getCollectionNames()` | ok |
| Persistencia | Parte 1 | [`persistencia.md`](./evidencias/persistencia.md) | `down` / `up` / `GET` | Catálogo ok · falta repetir con los tres |
| Fallo de dependencia | Parte 3 | [`fallo-dependencia.md`](./evidencias/fallo-dependencia.md) | `docker compose stop catalogo-service` | ok |
| Logs | Parte 1 | [`logs.md`](./evidencias/logs.md) | `docker compose logs -f <svc>` | Catálogo ok · falta Inventario y Ventas |
| Swagger | Parte 1 | [`swagger.md`](./evidencias/swagger.md) | abrir `/api-docs` | Catálogo ok · falta Inventario y Ventas |
| Configuración por entorno | Parte 2 | [`configuracion-entorno.md`](./evidencias/configuracion-entorno.md) · [`11-configuracion-por-entorno.md`](./11-configuracion-por-entorno.md) §11.3 | modo local y modo Compose con el mismo código | ok |
| Startup / disponibilidad | Parte 1 | [`startup.md`](./evidencias/startup.md) | `docker compose stop catalogo-db` | Catálogo ok · falta Inventario y Ventas |
| Fallo parcial | Parte 3 | [`fallo-parcial.md`](./evidencias/fallo-parcial.md) | ver [`12-comunicacion-y-fallos.md`](./12-comunicacion-y-fallos.md) | ok |
| Datos de prueba | Parte 3 | [`datos-prueba.md`](./evidencias/datos-prueba.md) | `node scripts/seed.js` | ok |
| Failover de Inventario (extra) | Parte 2 | [`inventario-pruebas.md` §4 y §4.1](./evidencias/inventario-pruebas.md#41-failover-en-docker-compose-comprando-por-ventas) | `docker compose stop <leader>` | ok (local y Compose) |

El estado pasa a `ok` cuando la evidencia tiene la salida real de una corrida. Las de la
Parte 1 se corrieron el 2026-10-20 con Catálogo, las tres bases y Redis (Inventario y Ventas
todavía no tenían Dockerfile); antes del tag se repiten sobre `main` con los tres servicios.
