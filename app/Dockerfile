# DB Agent — Node/Express + built React UI.
# Configure the SQL engine and LLM via env (see .env.example), or use docker-compose.yml
# for a self-contained Postgres demo.
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
# All top-level modules by glob: an explicit list silently went stale twice (queryShape.js, exampleFit.js).
COPY *.js benchmarks.json ./
COPY sqlEngines ./sqlEngines
COPY memoryBackends ./memoryBackends
COPY data ./data
COPY scripts ./scripts
COPY gateway ./gateway
COPY bin ./bin
EXPOSE 3001
CMD ["node", "server.js"]
