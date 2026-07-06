# Build context must be the repository root (pnpm workspace):
#   docker build -f artifacts/m365-dashboard/Dockerfile .

# ---- build ----
FROM node:24-slim AS build
RUN npm install -g pnpm@10
WORKDIR /app

# Lockfile-only layer, cache-shared with the api-server image
COPY pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
RUN pnpm fetch

COPY . .
RUN pnpm install --frozen-lockfile --offline
ENV NODE_ENV=production
RUN pnpm --filter @workspace/m365-dashboard run build

# ---- runtime ----
FROM nginx:1.29-alpine
COPY artifacts/m365-dashboard/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/artifacts/m365-dashboard/dist/public /usr/share/nginx/html
EXPOSE 80
HEALTHCHECK --interval=15s --timeout=5s --start-period=5s --retries=3 \
  CMD wget -q --spider http://127.0.0.1/healthz || exit 1
