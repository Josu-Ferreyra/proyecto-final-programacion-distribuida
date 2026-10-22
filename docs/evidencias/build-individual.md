# Build individual de las imágenes

**Objetivo:** cada servicio construye su imagen solo con lo declarado en su carpeta (sin
`.env`, `node_modules/` ni archivos locales: ver el `.dockerignore` de cada uno).

```bash
git clone <repo> tp6-limpio && cd tp6-limpio      # clon limpio
docker build -t grupo/catalogo:tp6 ./services/catalogo
docker build -t grupo/inventario:tp6 ./services/inventario
docker build -t grupo/ventas:tp6 ./services/ventas
docker image ls grupo/*
```

Prueba de la imagen de Catálogo sola, sin Compose:

```bash
docker network create tp6-prueba
docker run -d --rm --name catalogo-db --network tp6-prueba mongo:7
docker run -d --rm --name catalogo --network tp6-prueba -p 3100:3100 \
  -e SERVICE_NAME=catalogo-service -e PORT=3100 \
  -e MONGODB_URI=mongodb://catalogo-db:27017/catalogo grupo/catalogo:tp6
curl http://localhost:3100/health
docker stop catalogo catalogo-db && docker network rm tp6-prueba
```

## Salida obtenida

Corrida del 2026-10-20 en un clon limpio de la rama `docs/tp6-deployment` (commit `79b2e3a`), antes del merge a `main`. Inventario y Ventas todavía no tienen Dockerfile, así que sus bloques de `compose.yml` están comentados y esta corrida cubre Catálogo, las tres bases y Redis. **Se repite sobre `main` con los tres servicios antes del tag `tp6-entrega`.**

Build de Catálogo sin caché:

```text
$ cd tp6-limpio

$ docker build --no-cache --progress=plain -t grupo/catalogo:tp6 ./services/catalogo 2>&1 | grep -E "^#[0-9]+ (\[|DONE|naming)" | grep -v "load\|internal"
#1 DONE 0.0s
#2 DONE 0.7s
#3 DONE 0.0s
#4 DONE 0.0s
#5 [1/5] FROM docker.io/library/node:24-alpine@sha256:44fce696f38ba8c987c4db89954051000bbd05ffd8d8659ba15ed4a8602e937f
#5 DONE 0.0s
#6 [2/5] WORKDIR /app
#7 [3/5] COPY package*.json ./
#7 DONE 0.1s
#8 [4/5] RUN npm ci --omit=dev
#8 DONE 3.9s
#9 [5/5] COPY src ./src
#9 DONE 0.1s
#10 naming to docker.io/grupo/catalogo:tp6 done
#10 DONE 1.7s
```

Imagen sola, sin Compose (incluye qué hay dentro de la imagen):

```text
$ cd tp6-limpio

$ git log --oneline -1
79b2e3a Actualizar el README para el TP6

$ docker build --progress=plain -t grupo/catalogo:tp6 ./services/catalogo 2>&1 | grep -E "^#[0-9]+ \[|DONE|naming"
#1 [internal] load build definition from Dockerfile
#1 DONE 0.0s
#2 [internal] load metadata for docker.io/library/node:24-alpine
#2 DONE 1.3s
#3 [internal] load .dockerignore
#3 DONE 0.0s
#4 [internal] load build context
#4 DONE 0.0s
#5 [1/5] FROM docker.io/library/node:24-alpine@sha256:44fce696f38ba8c987c4db89954051000bbd05ffd8d8659ba15ed4a8602e937f
#5 DONE 0.0s
#6 [3/5] COPY package*.json ./
#7 [2/5] WORKDIR /app
#8 [4/5] RUN npm ci --omit=dev
#9 [5/5] COPY src ./src
#9 DONE 0.1s
#10 naming to docker.io/grupo/catalogo:tp6 done
#10 DONE 0.6s

$ docker image ls grupo/catalogo
IMAGE                ID             DISK USAGE   CONTENT SIZE   EXTRA
grupo/catalogo:tp6   db2026565399        299MB         76.5MB        

$ docker network create tp6-prueba
87ef3e53a40798994560aa408b0df8e25884e2bc117f66c436dece06ffdcb798

$ docker run -d --rm --name catalogo-db --network tp6-prueba mongo:7
c4299279e83f0e41a34465a5cf4c4135e450fb6e138058eb8fb3d57dd1434bad

$ docker run -d --rm --name catalogo --network tp6-prueba -p 3100:3100 -e SERVICE_NAME=catalogo-service -e PORT=3100 -e MONGODB_URI=mongodb://catalogo-db:27017/catalogo grupo/catalogo:tp6
ea7dfec3bf89f8fdbdc4f1a9cb85b8cda978ecf0fc5b624140731400f56094bf

$ sleep 6

$ curl -s http://localhost:3100/health
{"service":"catalogo-service","status":"ok"}
$ docker logs catalogo
{"level":"info","message":"Iniciando servicio","operacion":"arranque","puerto":3100,"servicio":"catalogo-service","timestamp":"2026-10-20T23:05:51.218Z"}
{"db":"catalogo","level":"info","message":"MongoDB conectado","operacion":"db.connect","servicio":"catalogo-service","timestamp":"2026-10-20T23:05:51.247Z"}
{"level":"info","message":"API escuchando en el puerto 3100 (docs: /api-docs)","operacion":"arranque","servicio":"catalogo-service","timestamp":"2026-10-20T23:05:51.277Z"}

$ docker run --rm grupo/catalogo:tp6 sh -c 'ls -a /app; whoami; ls /app/node_modules | wc -l; test -e /app/.env && echo "HAY .env" || echo "sin .env en la imagen"'
.
..
node_modules
package-lock.json
package.json
src
node
109
sin .env en la imagen

$ docker stop catalogo catalogo-db
catalogo
catalogo-db

$ docker network rm tp6-prueba
tp6-prueba
```

**Resultado:** ✅ Catálogo se construye solo con lo de su carpeta, la imagen no lleva `.env`, corre como el usuario `node` y responde `/health`. Inventario y Ventas: pendiente (Partes 2 y 3).

**Resultado esperado:** las tres imágenes se construyen sin errores y `/health` responde
`{"service":"catalogo-service","status":"ok"}`.
