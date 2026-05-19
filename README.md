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
