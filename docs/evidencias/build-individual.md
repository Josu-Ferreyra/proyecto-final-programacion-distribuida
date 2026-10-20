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

_Pendiente de ejecutar._

**Resultado esperado:** las tres imágenes se construyen sin errores y `/health` responde
`{"service":"catalogo-service","status":"ok"}`.
