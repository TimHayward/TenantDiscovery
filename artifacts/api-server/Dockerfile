# Build context must be the repository root (pnpm workspace):
#   docker build -f artifacts/api-server/Dockerfile .

# ---- build ----
FROM node:24-slim AS build
RUN npm install -g pnpm@10
WORKDIR /app

# Lockfile-only layer: downloads every package into the pnpm store.
# Identical in both app images, so the Docker layer cache is shared,
# and it only invalidates when the lockfile changes.
COPY pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
RUN pnpm fetch

COPY . .
RUN pnpm install --frozen-lockfile --offline
RUN pnpm --filter @workspace/api-server run build

# The esbuild bundle externalizes @libsql/client, libsql and @azure/* (see
# build.mjs), so production node_modules must exist at runtime. `pnpm deploy`
# produces a self-contained dir with only this package's prod deps.
RUN pnpm --filter @workspace/api-server deploy --prod --legacy /prod/api-server

# ---- runtime ----
FROM node:24-slim
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=5100 \
    METRIC_DB_PATH=/data/metrics.db \
    ONBOARDING_SETTINGS_DIR=/data
WORKDIR /app
COPY --from=build --chown=node:node /prod/api-server /app
COPY --from=build --chown=node:node /app/artifacts/api-server/dist /app/dist
RUN mkdir -p /data && chown node:node /data
USER node
EXPOSE 5100
HEALTHCHECK --interval=15s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||5100)+'/api/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "--enable-source-maps", "dist/index.mjs"]
