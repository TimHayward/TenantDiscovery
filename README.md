# TenentDiscovery
Discovery tool for Microsoft 365 tenant

## Prerequisites

- Node.js 18+
- pnpm (required for this monorepo)

## Environment Configuration

The API server requires Azure credentials to connect to Microsoft Graph. Set the following environment variables:

```bash
export AZURE_TENANT_ID="your-tenant-id"
export AZURE_CLIENT_ID="your-client-id"
export AZURE_CLIENT_SECRET="your-client-secret"
```

Or create a `.env` file in the `artifacts/api-server` directory with these variables.

On Windows PowerShell:
```powershell
$env:AZURE_TENANT_ID = "your-tenant-id"
$env:AZURE_CLIENT_ID = "your-client-id"
$env:AZURE_CLIENT_SECRET = "your-client-secret"
```

### Network exposure (optional)

The API server is unauthenticated and holds Graph credentials, so by default it only listens on `127.0.0.1` and does not send CORS headers. The dashboard reaches it through the Vite `/api` proxy, which works without any of these settings. Override only if you understand the exposure:

| Variable | Default | Purpose |
|----------|---------|---------|
| `HOST` (api-server) | `127.0.0.1` | Bind address. Set `0.0.0.0` to expose the API on the network. |
| `CORS_ALLOWED_ORIGINS` (api-server) | _(none)_ | Comma-separated origins allowed to call the API cross-origin, e.g. `https://dashboard.example.com`. Unset = no CORS. |
| `ALLOWED_HOSTS` (m365-dashboard) | _(none)_ | Comma-separated extra hostnames the Vite dev/preview server responds to. `localhost`, IP addresses, and Replit preview domains (`REPLIT_DOMAINS`/`REPLIT_DEV_DOMAIN`) are always allowed. |

## Installation

```bash
pnpm install
```

## Building

Build the entire workspace including all packages and servers:

```bash
pnpm run build
```

Build a specific package:

```bash
pnpm --filter @workspace/api-server run build
pnpm --filter @workspace/m365-dashboard run build
```

## Running the Servers

### API Server

Development mode (build + start):
```bash
pnpm --filter @workspace/api-server run dev
```

Build only:
```bash
pnpm --filter @workspace/api-server run build
```

Start (after building):
```bash
pnpm --filter @workspace/api-server run start
```

### M365 Dashboard

Development mode (Vite dev server):
```bash
pnpm --filter @workspace/m365-dashboard run dev
```

Build for production:
```bash
pnpm --filter @workspace/m365-dashboard run build
```

Preview production build:
```bash
pnpm --filter @workspace/m365-dashboard run serve
```

## Running with Docker

Build and run the whole stack (API server + dashboard behind nginx) with Docker Compose:

```bash
cp .env.example .env   # fill in the AZURE_* values, or configure them later via the onboarding UI
docker compose up -d --build
```

Then open http://localhost:8089 (change with `DASHBOARD_PORT` in `.env`). The dashboard's nginx serves the built SPA and reverse-proxies `/api` to the API container, so no CORS setup is needed and only one port is exposed.

Notes:
- The metrics database (`metrics.db`) and onboarding settings persist in the `api-data` named volume. `docker compose down` keeps them; `docker compose down -v` wipes them.
- Health: `curl http://localhost:8089/api/healthz` (proxied to the API server).
- Docker is for production-style runs; local development continues via the pnpm commands above.

## Type Checking

Check TypeScript types for all packages:
```bash
pnpm run typecheck
```

Check specific package:
```bash
pnpm --filter @workspace/api-server run typecheck
```

## Testing

Run tests for the API server:
```bash
pnpm --filter @workspace/api-server run test
```
