# Imagen del Servicio de Inventario. Una sola imagen para los 3 nodos del cluster: lo
# que distingue a cada uno (RAFT_NODO_ID, MONGODB_URI, CLUSTER_FILE) es configuración.
FROM node:24-alpine

WORKDIR /app
# production: solo dependencias de ejecución y logs en JSON por stdout
ENV NODE_ENV=production

# Primero las dependencias, para que Docker reuse esta capa si solo cambia el código
COPY package*.json ./
RUN npm ci --omit=dev

COPY src ./src
COPY scripts ./scripts
# Topologías del cluster (sin secretos). En Compose se usa cluster.docker.json.
COPY cluster.*.json ./

# 3200: API pública · 4200: RPC interno de Raft (solo entre nodos, no se publica)
EXPOSE 3200 4200
USER node
# node directo (no "npm start"): recibe SIGTERM de "docker stop" y cierra Mongo y Redis,
# y no busca un .env que en la imagen no existe.
CMD ["node", "src/server.js"]
