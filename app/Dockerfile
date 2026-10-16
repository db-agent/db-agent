# DB Agent — Node/Express + built React UI.
# Expects Databricks credentials via env (see .env.example).
FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY web/package.json web/package-lock.json ./web/
RUN cd web && npm ci
COPY . .
RUN npm run build

FROM node:22-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3001
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY --from=build /app/web/dist ./web/dist
COPY server.js logger.js sqlSafety.js knowledge.js memory.js benchmarks.js ./
COPY sqlEngines ./sqlEngines
COPY memoryBackends ./memoryBackends
COPY data ./data
EXPOSE 3001
CMD ["node", "server.js"]
