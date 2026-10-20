# services/

Un microservicio por carpeta, cada uno con su `package.json`, su `.env.example`, su
`Dockerfile`, su `.dockerignore` y su README. Ninguno importa código de otro ni accede a la
base de otro: se comunican solo por HTTP (contratos C1–C4 de
[`docs/06-comunicaciones.md`](../docs/06-comunicaciones.md)).

| Carpeta | Servicio | Responsable | Puerto |
|---|---|---|---|
| [`catalogo/`](catalogo/) | Catálogo: qué se ofrece y a qué precio | Josué Ferreyra | 3100 |
| `inventario/` | Inventario: unidades disponibles (cluster Raft de 3 nodos) | Santiago Vicente | 3200 (3201–3203 en local) |
| `ventas/` | Ventas: compras y su ciclo de vida | Matías Porcari | 3300 |

Todos cumplen lo mismo (`docs/08-ratificacion-tp6.md` §8.3): `GET /health`, Swagger en
`/api-docs`, logs por stdout con el nombre del servicio, errores `{ error, servicio }`,
conexión a Mongo con reintentos y `503` si la base se cae, y ninguna URL escrita en el
código.

Se levantan todos juntos desde la raíz con `docker compose up --build -d`, o cada uno por
separado con `npm start` (ver el README de cada servicio).
