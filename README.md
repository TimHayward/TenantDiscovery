# TenentDiscovery
Discovery tool for Microsoft 365 tenant

## Prerequisites

- Node.js 22+
- pnpm 10+ (required for this monorepo)

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

The API server holds Graph credentials, so by default it only listens on `127.0.0.1`, requires no token, and does not send CORS headers. The dashboard reaches it through the Vite `/api` proxy, which works without any of these settings. Override only if you understand the exposure:

| Variable | Default | Purpose |
|----------|---------|---------|
| `HOST` (api-server) | `127.0.0.1` | Bind address. Set `0.0.0.0` to expose the API on the network. |
| `ALLOW_REMOTE` (api-server) | _(unset)_ | Must be `true` before the server will bind to a non-loopback `HOST`. Without it, an accidental `HOST=0.0.0.0` refuses to start. |
| `API_AUTH_TOKEN` (api-server) | _(none)_ | Bearer token the API accepts when bound off loopback. Overrides the token generated during onboarding. |
| `CORS_ALLOWED_ORIGINS` (api-server) | _(none)_ | Comma-separated origins allowed to call the API cross-origin, e.g. `https://dashboard.example.com`. Unset = no CORS. |
| `ALLOWED_HOSTS` (m365-dashboard) | _(none)_ | Comma-separated extra hostnames the Vite dev/preview server responds to. `localhost`, IP addresses, and Replit preview domains (`REPLIT_DOMAINS`/`REPLIT_DEV_DOMAIN`) are always allowed. |

#### API authentication

Authentication is decided by the bind address, not by a switch:

- **On loopback (the default), no token is required.** The binding is the control. Nothing about the local developer workflow changes.
- **Off loopback, every `/api` route requires `Authorization: Bearer <token>`.** The binding no longer protects anything, so a credential has to.

The token is generated on the first onboarding save, from 32 bytes of `crypto.randomBytes`, and is stored in `onboarding-settings.json`. It is returned in full exactly once, in the response to the onboarding save that created it, and is reported as a boolean (`hasApiToken`) on every read afterwards. If it is lost, remove the `apiToken` field from the settings file and save onboarding again to issue a new one.

Two details are worth knowing before exposing the API:

- `GET /api/healthz` is served without a token, so a container health check keeps working. No other route is exempt, including `/api/healthz/with-metadata`.
- Failed authentication attempts are counted per client address in a fixed one-minute window. After ten failures the API answers `429` with a `Retry-After` header until the window elapses. A successful request clears the count.

Bind off loopback with no token configured and the API answers `503` rather than serving data. Either complete onboarding on loopback first, or set `API_AUTH_TOKEN`.

### Secrets at rest

`onboarding-settings.json` holds the Azure client secret and the API token in cleartext, and `metrics.db` holds collected tenant data including user principal names. Both are restricted to the account running the server as soon as they are created: `chmod 0600` on POSIX, and on Windows an ACL that drops inheritance and grants full control to the current user alone. If that call fails the server logs a warning and continues rather than refusing to start, so the file may be more readable than intended on a machine where the permission change did not take.

The client secret is not additionally encrypted at rest, and this is a deliberate choice rather than an omission. Encrypting it with Windows DPAPI (`CryptProtectData`) would require a native module, which conflicts with this project's dependency posture: `pnpm-workspace.yaml` sets `minimumReleaseAge: 1440` and keeps an explicit `onlyBuiltDependencies` allowlist precisely to limit what may run at install time, and the Docker image is Linux, where DPAPI does not exist at all. More to the point, it would buy very little. DPAPI in user scope decrypts for anything running as that user, which is the same boundary the file permissions already draw. The residual risk is therefore unchanged in the case that matters: **anything running as the account that runs this server can read the client secret and the API token, and can therefore act as the Azure app registration.** File permissions protect the secret from *other* local accounts and from a backup or file share that would otherwise expose it; they do not protect it from the user themselves, from an administrator, or from anyone who can read the disk offline. Treat full-disk encryption and the trustworthiness of the account as the controls that matter here.

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
