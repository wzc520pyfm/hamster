# syntax=docker/dockerfile:1
FROM node:24-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production

COPY package.json package-lock.json ./
RUN npm install --no-audit --no-fund

COPY agent ./agent
COPY lib ./lib
COPY tsconfig.json ./

# Build the eve server. No model provider key is required for the scripted
# fixture model; HAMSTER_MODEL_ID switches to a real provider at runtime.
RUN npx eve build

EXPOSE 8081
ENV PORT=8081
# The local Workflow world persists session state under /app/.eve; mount a volume there.
CMD ["npx", "eve", "start", "--host", "0.0.0.0", "--port", "8081"]
