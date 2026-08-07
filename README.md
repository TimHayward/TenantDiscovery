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

## Offline demonstration mode

Seeing this tool work normally requires a tenant, an app registration, consented permissions and a successful collection run. Demonstration mode removes all four: the server reads a recorded snapshot from `fixtures/` instead of calling Microsoft Graph, and the dashboard runs on it exactly as it runs on a real tenant.

```bash
DEMO_MODE=neglected-smb pnpm --filter @workspace/api-server run dev
pnpm --filter @workspace/m365-dashboard run dev
```

Two profiles ship with the repository:

| Profile | Shape |
|---------|-------|
| `healthy-mid-market` | Roughly 250 users, MFA broadly enforced, Secure Score 462/600, a short tail of low-severity findings |
| `neglected-smb` | Roughly 60 users, sparse MFA, legacy authentication permitted, ownerless app registrations with expired secrets, anonymous sharing links, no DLP policies and the audit log off |

**Both profiles are entirely invented.** No tenant was contacted to produce them. Every domain is under the RFC 2606 reserved `.example` TLD, every identifier is a readable `demo-...` string rather than a GUID, and every display name carries a `(demo)` suffix so that a screenshot of any tab, and every row of a PDF or spreadsheet export, says so on its face. `fixtures/build.mjs` is committed alongside the data it writes so a reviewer can see exactly how each value was produced.

With `DEMO_MODE` set:

- the Graph client refuses to issue credentials or a client at all, so no outbound call to Microsoft is possible;
- onboarding is satisfied, so the dashboard renders rather than routing to setup;
- every API response carries an `X-Demo-Mode` header and a `demoMode` property;
- the fact is logged at startup as a boxed warning;
- the dashboard shows a persistent banner that cannot be dismissed, on every tab, taken from the API response rather than from a build-time constant — so a production build pointed at a demonstration server still shows it.

With `DEMO_MODE` unset, none of the above happens and behaviour is unchanged.

| Variable | Default | Purpose |
|----------|---------|---------|
| `DEMO_MODE` (api-server) | _(unset)_ | Name of a directory under `fixtures/`. Set it to serve that profile instead of calling Graph. |
| `DEMO_FIXTURES_DIR` (api-server) | _(unset)_ | Where the fixture profiles live. Only needed when the server runs away from the repository, such as in a container. |

### Recording a fixture from a real tenant

`scripts/src/exportFixture.ts` records a running server's collection into a new profile:

```bash
pnpm --filter @workspace/scripts exec tsx src/exportFixture.ts \
  --profile acme-manufacturing --api http://127.0.0.1:5100
```

It redacts by default and fails closed. Tenant identifiers, user principal names, display names, email addresses, device names, object identifiers and free text are replaced with generated equivalents, consistently, so references between snapshots survive. Any field it does not recognise is **dropped**, with a warning naming the field and where it was found, rather than passed through.

> **A recording is not a fixture until a human has read it.** Redaction by field name cannot see a tenant name inside a policy description, a supplier in a SharePoint site title or a customer in a Teams channel name. The recorder writes to `fixtures/<profile>/recorded-<timestamp>/`, which `.gitignore` excludes, so a raw recording cannot be committed by accident. Promoting one is a deliberate act: review every file, move it up into the profile directory, and set `synthetic` in the manifest honestly.

### Collection tuning (optional)

Collectors reach Microsoft Graph and Defender for Endpoint through one shared fetch helper, which bounds how long a request may take, how often it is retried, and how many requests may be in flight against a single host at once. The defaults suit a tenant of any size and should be left alone unless a refresh is demonstrably being throttled.

| Variable | Default | Purpose |
|----------|---------|---------|
| `GRAPH_MAX_CONCURRENCY` (api-server) | `8` | Concurrent requests allowed against `graph.microsoft.com`. Several collectors issue one request per discovered principal or device, so without a ceiling a large tenant throttles itself. |
| `DEFENDER_MAX_CONCURRENCY` (api-server) | `8` | The same ceiling for `api.security.microsoft.com` and `api.securitycenter.microsoft.com`. Defender has its own budget, so a throttled Graph cannot hold up Defender collection. |
| `GRAPH_FETCH_TIMEOUT_MS` (api-server) | `60000` | How long a single collection request may take before it is abandoned and reported as a collection issue. |
| `GRAPH_MAX_RETRIES` (api-server) | `3` | How many times a throttled (429) or transient (5xx) response is retried. A server-provided `Retry-After` is honoured up to two minutes; a computed backoff is jittered and capped at thirty seconds. |

Lower the two concurrency ceilings if the tenant still reports throttling, and raise them only with evidence: issuing more requests than a tenant tolerates makes a refresh slower rather than faster, because every throttled request is retried. Setting either to `1` serialises collection against that host and will make a full refresh take considerably longer. A value below `1` is treated as `1`, since a ceiling of zero would stall collection entirely.

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
