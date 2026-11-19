# syntax=docker/dockerfile:1
FROM node:24-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY . .
# Same-origin relative /api (empty). Do NOT bake localhost:8080 — phones would hit their own loopback.
ARG VITE_API_BASE_URL=
ENV VITE_API_BASE_URL=$VITE_API_BASE_URL
RUN npm run build

FROM node:24-bookworm-slim
WORKDIR /app
COPY --from=build /app/dist ./dist
COPY server.mjs ./server.mjs
ENV PORT=3000
ENV API_UPSTREAM=http://api:8080
EXPOSE 3000
USER node
CMD ["node", "server.mjs"]
