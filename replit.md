# Workspace

## Overview

pnpm workspace monorepo using TypeScript. Each package manages its own dependencies.

## Stack

- **Monorepo tool**: pnpm workspaces
- **Node.js version**: 24
- **Package manager**: pnpm
- **TypeScript version**: 5.9
- **API framework**: Express 5
- **Database**: PostgreSQL + Drizzle ORM
- **Validation**: Zod (`zod/v4`), `drizzle-zod`
- **API codegen**: Orval (from OpenAPI spec)
- **Build**: esbuild (CJS bundle)

## Key Commands

- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- `pnpm --filter @workspace/api-server run dev` — run API server locally

See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details.

## Artifacts

### M365 Health Dashboard (`artifacts/m365-dashboard`)
- **Preview path**: `/m365-dashboard/`
- **Purpose**: Comprehensive Microsoft 365 tenant health dashboard pulling live data from Microsoft Graph API using an Azure app registration
- **Tech**: React + Vite + Recharts + TanStack Table + shadcn/ui
- **Tabs**: Overview, Users & Identity, Licenses, Security, Exchange Online, Teams & SharePoint, Compliance & Health, Intune
- **Security Checklist**: Every tab has a `ChecklistTable` appended at the bottom (`src/components/ChecklistTable.tsx`) mapping to spec sections 1–7:
  - Users & Identity → Section 1 (1.1–1.23, live status from CA policies + MFA data)
  - Exchange Online → Section 2 (2.1–2.8, manual — API doesn't expose policy config)
  - Teams & SharePoint → Sections 3 + 5 (live for external/guest access; rest manual)
  - Intune → Section 4 (4.1–4.10, live from device/compliance/config profile counts)
  - Security → Section 6 (6.1–6.9, Secure Score live; MCAS/high-risk from CA policies)
  - Compliance → Section 7 (7.1–7.5, live audit/DLP/retention/label data)
  - Section 6 implementation status: complete and rendered in the Security tab checklist.
- **Data source**: Microsoft Graph API (app registration via client credentials)
- **Auth secrets**: `AZURE_TENANT_ID`, `AZURE_CLIENT_ID`, `AZURE_CLIENT_SECRET`
- **Graph client**: `artifacts/api-server/src/lib/graphClient.ts` (uses `@azure/identity` + `@microsoft/microsoft-graph-client`)
- **Caching**: 5-minute in-memory cache via `node-cache`
- **API routes**: `artifacts/api-server/src/routes/m365*.ts` (10 route files, including `/api/m365/data-sources`)

### Metric Data Source Registry
- Canonical metric-to-evidence mapping is defined in `lib/permissions-manifest/src/manifest.ts`.
- API exposure endpoint: `GET /api/m365/data-sources` (optionally filtered by `tab`).
- Dashboard KPI cards consume this metadata to display evidence status and confidence labels.
- Manual-check metadata is modeled centrally via `manualCheck` objects in the manifest and consumed by checklist rows.

### App Registration Permissions Manifest
The source of truth now lives in `lib/permissions-manifest/src/manifest.ts` with a machine-readable export at `lib/permissions-manifest/src/generated/permissions.manifest.json`.

#### Required Microsoft Graph application permissions
- `Application.Read.All`
- `Directory.Read.All`
- `Organization.Read.All`
- `Policy.Read.All`
- `Reports.Read.All`
- `SecurityEvents.Read.All`
- `ServiceHealth.Read.All`
- `Team.ReadBasic.All`
- `UserAuthenticationMethod.Read.All`

#### Optional current-feature permissions
- `AuditLog.Read.All` — compliance evidence and optional service-principal enrichment
- `DeviceManagementApps.Read.All` — Intune app installation health
- `DeviceManagementConfiguration.Read.All` — Intune policy and configuration summaries
- `DeviceManagementManagedDevices.Read.All` — Intune device detail and discovered apps
- `IdentityRiskEvent.Read.All` — risky users and identity risk events
- `InformationProtectionPolicy.Read.All` — sensitivity-label inventory in compliance tab
- `https://api.security.microsoft.com/.default` — external Microsoft Defender scope, not a Graph permission

#### Future permissions
- `Sites.Read.All` — keep in future until direct SharePoint site APIs are used
- `Exchange.ManageAsApp` — for future Exchange-specific evidence outside Graph
