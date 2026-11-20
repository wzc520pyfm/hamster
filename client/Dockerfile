# syntax=docker/dockerfile:1
FROM node:24-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY . .
# Empty default → browser uses same-origin /api via server.mjs proxy.
# Override only for deliberate cross-origin bake experiments.
ARG VITE_API_BASE_URL=
ENV VITE_API_BASE_URL=$VITE_API_BASE_URL
RUN npm run build

FROM node:24-bookworm-slim
WORKDIR /app
# Pure Node stdlib server — no global `serve`, no npm install in runtime stage.
COPY --from=build /app/dist ./dist
COPY server.mjs ./server.mjs
ENV PORT=3000
ENV DIST_DIR=/app/dist
# Compose should set API_UPSTREAM=http://api:8080 for same-origin /api.
ENV API_UPSTREAM=http://127.0.0.1:8080
EXPOSE 3000
USER node
CMD ["node", "server.mjs"]
