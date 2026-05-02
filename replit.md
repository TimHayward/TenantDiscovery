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
- **Data source**: Microsoft Graph API (app registration via client credentials)
- **Auth secrets**: `AZURE_TENANT_ID`, `AZURE_CLIENT_ID`, `AZURE_CLIENT_SECRET`
- **Graph client**: `artifacts/api-server/src/lib/graphClient.ts` (uses `@azure/identity` + `@microsoft/microsoft-graph-client`)
- **Caching**: 5-minute in-memory cache via `node-cache`
- **API routes**: `artifacts/api-server/src/routes/m365*.ts` (9 route files)

### Required Azure App Registration Permissions (Application type, admin consented)
- `Directory.Read.All`
- `Reports.Read.All`
- `SecurityEvents.Read.All`
- `Policy.Read.All`
- `Sites.Read.All`
- `Team.ReadBasic.All`
- `Organization.Read.All`
- `AuditLog.Read.All`
- `ServiceHealth.Read.All`
- `UserAuthenticationMethod.Read.All`
- `IdentityRiskEvent.Read.All`
