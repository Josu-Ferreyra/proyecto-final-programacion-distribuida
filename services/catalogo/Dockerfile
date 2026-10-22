# Imagen del Servicio de Catálogo. Node 24 LTS, la misma versión que usa el grupo.
FROM node:24-alpine

WORKDIR /app
# production: solo dependencias de ejecución y logs en JSON por stdout
ENV NODE_ENV=production

# Primero las dependencias, para que Docker reuse esta capa si solo cambia el código
COPY package*.json ./
RUN npm ci --omit=dev

COPY src ./src

EXPOSE 3100
USER node
# node directo (no "npm start"): recibe SIGTERM de "docker stop" y cierra la conexión a
# Mongo, y no busca un .env que en la imagen no existe.
CMD ["node", "src/server.js"]
