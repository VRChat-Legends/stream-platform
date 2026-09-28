FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY tsconfig*.json vite.config.ts ./
COPY server ./server
COPY web ./web
RUN npm run check && npm run build && npm prune --omit=dev
FROM node:22-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/dist ./dist
COPY --from=build --chown=node:node /app/dist-server ./dist-server
COPY --from=build /app/package.json /app/package-lock.json ./
RUN mkdir -p /data/uploads && chown -R node:node /data
USER node
EXPOSE 3000 3001
CMD ["node","dist-server/server.js"]
