# syntax=docker/dockerfile:1
FROM node:24-bookworm-slim AS deps
WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev --no-audit --no-fund

FROM node:24-bookworm-slim
ENV NODE_ENV=production
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY package.json index.js ./
COPY src ./src
EXPOSE 8080
USER node
CMD ["node", "index.js"]
