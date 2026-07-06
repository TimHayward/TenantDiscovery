# Backlog

Redrafted from the full code review of the working tree on **2026-07-06** (three-agent review: api-server, dashboard, cross-cutting infrastructure). Supersedes the 2026-07-02 draft; resolved items are compressed into the [Completed](#completed) changelog at the bottom. Items graduate into [ROADMAP.md](ROADMAP.md) sprints when picked up.

**How to read:** each item carries a priority (**P1** fix now / **P2** next batch / **P3** opportunistic), an effort estimate (**S** < half a day, **M** ~1–2 days, **L** multi-day), tags (`bug`, `security`, `consistency`, `dx`, `feature`), and a suggested execution model — **[Opus]** for architectural / multi-file / judgment-heavy work, **[Sonnet]** for mechanical, well-specified changes. Every item ends with **Accept:** criteria an agent can verify. File anchors reference the working tree as of 2026-07-06.

---

## This Week (proposed)

Sequenced plan; each step unblocks or de-risks the next.

| # | Item | Why now | Depends on |
|---|------|---------|------------|
| W0 | **Commit the working tree** — ~2,100-line uncommitted diff plus untracked files (`BACKLOG.md`, 5 test files, `lib/csv.ts`, `lib/dns/`, `lib/exchangeOnline.ts`, `findings/frameworks/`, 5 rule modules). Regenerate the stale manifest JSON (1.9) first, then commit in logical units: (1) findings rules split + frameworks, (2) DNS email-auth + exchangeOnline, (3) csv parser + tests, (4) spec additions + regenerated clients, (5) dashboard shared-component migrations, (6) BACKLOG.md. | Nothing this week is safe to build on an uncommitted tree; review anchors rot. | 1.9 |
| W1 | [1.7](#17--executive-pdf-export-throws-on-non-winansi-characters--bug-s-sonnet) PDF WinAnsi crash | Whole executive PDF export 500s for tenants with any non-Latin display name. | W0 |
| W2 | [1.8](#18--gate-the-exchange-online-dkim-call-on-cert-auth-being-configured--bug-s-sonnet) DKIM gating | Every Exchange collection currently generates a guaranteed permission failure that poisons the tab's status. | W0 |
| W3 | [2.3](#23-enforce-request-validation-with-the-existing-api-zod-schemas--security-m-opus) zod validation middleware | Foundation piece: closes the remaining unvalidated-input nits in one pattern. | W0 |
| W4 | [3.2](#32-standardize-loading-error-and-empty-states--consistency-l-opus) loading/error/empty overhaul | The dashboard's biggest defect: failed queries render as healthy zeros in every data tab, and refetches blank 14 surfaces to skeletons. | W0 |
| W5 | [5.4](#54-eslint--ci-pipeline--dx-m-sonnet) ESLint + CI | Lands last so lint runs on a clean tree; CI then locks typecheck + tests for everything above. | W0–W4 |
| Stretch | [5.3](#53-finish-the-openapi-spec-coverage--dx-s-sonnet) spec remainder, [3.3](#33-surface-collection-issues-on-every-tab--consistency-m-sonnet) banner rollout | Both are mechanical and independent. | W0 |

---

## P1 — Correctness

### 1.7 — Executive PDF export throws on non-WinAnsi characters — `bug` `S` **[Sonnet]**
`renderExecutivePdf` draws finding titles and evidence strings — which embed tenant display names / UPNs — using `StandardFonts.Helvetica` ([executive.ts:105-129](artifacts/api-server/src/lib/export/executive.ts#L105-L129)). pdf-lib's `drawText` throws on any code point outside WinAnsi, so a single CJK character or emoji in a display name fails the entire `/m365/export/executive.pdf` response with a 500. The HTML path is unaffected (escaped).
**Fix:** add a `toWinAnsi(text: string)` sanitizer in executive.ts that replaces unencodable code points (use `font.getCharacterSet()` or a try/encode-per-char fallback; simplest robust approach: strip/replace anything outside ` -ÿ` plus known WinAnsi extras with `?`), and route every `drawText` payload through it. Do **not** add a font-embedding dependency for this fix (that can be a follow-up if fidelity matters).
**Accept:** a unit test in `src/lib/__tests__/` renders a PDF from a model containing `"李雷 (Sales) 🚀"` and `"Zoë Müller"` without throwing; Latin-1 names render unchanged; api-server typecheck + tests green.

### 1.8 — Gate the Exchange Online DKIM call on cert-auth being configured — `bug` `S` **[Sonnet]**
`fetchDkimSigningConfigs()` is called unconditionally on every Exchange collection ([exchange.ts:74-75](artifacts/api-server/src/lib/collectors/exchange.ts#L74-L75)). App-only EXO access is impossible with a client secret (see feature 6.1), so under the current credential this is a *guaranteed* 401/403 → a `permission` collection issue every run, which trips `permissionError` handling for the whole Exchange snapshot even though the DNS fallback works.
**Fix:** only attempt the EXO call when a certificate credential is configured (config flag from `setupConfig` — add e.g. `exchangeCertAuth?: boolean` or detect the credential type where the EXO client is built in [exchangeOnline.ts](artifacts/api-server/src/lib/exchangeOnline.ts)); otherwise skip straight to the DNS selector fallback and record at most an `info`-level note ("authoritative DKIM unavailable without certificate auth"), not a `permission` issue. While in the file: surface the 20-domain cap ([exchange.ts:71](artifacts/api-server/src/lib/collectors/exchange.ts#L71)) as a collection note instead of silently truncating.
**Accept:** with no cert configured, an Exchange collection produces zero `permission` issues attributable to DKIM; DKIM rows still populate via DNS with `dkimSource: "dns"`; tenants with >20 domains get a visible note; existing exchange/dns tests still pass.

### 1.9 — Regenerate stale `permissions.manifest.json` and guard its freshness — `bug` `S` **[Sonnet]**
[manifest.ts](lib/permissions-manifest/src/manifest.ts) is modified in the working tree but the generated `src/generated/permissions.manifest.json` (exported as `./manifest.json`) was not regenerated — consumers of the JSON export see stale data. Also verify the ≈189-vs-188 count mismatch between `metricId:` and `confidenceLabel:` occurrences flagged in review — pinpoint whether one metric entry lacks a required `confidenceLabel`.
**Fix:** run `pnpm --filter permissions-manifest run generate:json`; add a vitest (or a check in the 5.4 CI job) that regenerates to a temp path and diffs against the committed JSON, failing when stale. Fix the missing `confidenceLabel` if the mismatch is real.
**Accept:** regenerated JSON committed; freshness check fails when `manifest.ts` is edited without regen; every metric entry has a `confidenceLabel`.

---

## P2 — Security hardening

The strong baseline noted in the last review still holds (loopback-only default, no committed secrets, redaction sentinels, parameterized SQL, DoH-only DNS, escaped HTML export, in-memory export generation). These items are hardening on top.

### 2.1 Protect secrets and tenant PII at rest on Windows — `security` `M` **[Opus]**
`onboarding-settings.json` holds the Azure client secret in cleartext; `chmod 0600` applies only on non-Windows ([setupConfig.ts:128-131](artifacts/api-server/src/lib/setupConfig.ts#L128-L131)). `metrics.db` stores full tenant PII with no permission hardening on any platform ([metricStore.ts:31-34](artifacts/api-server/src/lib/metricStore.ts#L31-L34)).
**Fix:** at file-creation time apply owner-only Windows ACLs (`icacls <file> /inheritance:r /grant:r "%USERNAME%":F` via `child_process`, or a small native-free helper) to both files; `0600` the DB on POSIX; evaluate DPAPI (`CryptProtectData`) for the secret value itself and document the decision + residual risk in README.
**Accept:** on Windows, `icacls` output for both files shows only the owning user; on POSIX both are `0600`; secret round-trips through save/load; `setupConfig.test.ts` extended to assert the hardening hook is invoked (mock the platform call).

### 2.2 Guard against accidental network exposure of the unauthenticated API — `security` `S` **[Sonnet]**
Every route is unauthenticated; safety rests entirely on the `127.0.0.1` default ([index.ts:16](artifacts/api-server/src/index.ts#L16), bound at [index.ts:28](artifacts/api-server/src/index.ts#L28)). Setting `HOST=0.0.0.0` exposes tenant data and finding-state writes.
**Fix:** at startup, if `HOST` resolves non-loopback and `ALLOW_REMOTE !== "true"`, log a fatal explanation and exit; when allowed, log a prominent warning. Add `helmet` to [app.ts](artifacts/api-server/src/app.ts) (defaults are fine; disable CSP if it breaks nothing — the API serves JSON only).
**Accept:** `HOST=0.0.0.0 pnpm dev` refuses to start without `ALLOW_REMOTE=true`; loopback start unchanged; helmet headers present on `/api/healthz`; behaviour unit-tested by extracting the guard into a pure `assertSafeBinding(host, env)` helper.

### 2.3 Enforce request validation with the existing api-zod schemas — `security` `M` **[Opus]**
`@workspace/api-zod` is generated from the spec but only [health.ts](artifacts/api-server/src/routes/health.ts) uses it. `PATCH /onboarding/setup` casts `req.body` unchecked ([onboarding.ts](artifacts/api-server/src/routes/onboarding.ts)); `PATCH /m365/findings/:fingerprint` hand-validates ([m365Findings.ts:56-72](artifacts/api-server/src/routes/m365Findings.ts#L56-L72)); `/m365/export/*` accepts `scanId` unvalidated ([m365Export.ts:9-11](artifacts/api-server/src/routes/m365Export.ts#L9-L11)).
**Fix:** add `middlewares/validate.ts` exporting `validate({ body?, query?, params? })` wrapping `safeParse` → 400 with flattened issues; apply to every route that reads a body or query param, starting with the three above. Where a generated schema is missing, add it to the spec (coordinates with 5.3) rather than hand-writing zod.
**Accept:** invalid `dueDate`, unknown `status`, and garbage `scanId` all return 400 with a structured error body; supertest coverage for at least the findings PATCH and one export route; no route reads `req.body` without a schema (grep-verifiable: `req.body as` → 0 matches).

### 2.4 CSV formula-injection guard — `security` `S` **[Sonnet]**
[export/csv.ts:6-10](artifacts/api-server/src/lib/export/csv.ts#L6-L10) quotes correctly but doesn't neutralize cells beginning `=`, `+`, `-`, `@` (or tab/CR variants) — a crafted display name executes as a formula when opened in Excel.
**Fix:** in the server CSV serializer, prefix cells matching `/^[=+\-@\t\r]/` with `'`. Apply the same rule to the client-side exports by adding a shared `sanitizeCsvCell` in the dashboard (used by [ExportBtn.tsx](artifacts/m365-dashboard/src/components/ExportBtn.tsx) data mappers / react-csv payloads).
**Accept:** unit test: `=1+1`, `+SUM(A1)`, `-2`, `@cmd` round-trip with a leading `'`; ordinary negative-number strings documented as intentionally escaped; existing export tests updated.

### 2.5 Don't key the client cache on the raw secret — `security` `S` **[Sonnet]**
The Graph client cache key is `` `${tenantId}:${clientId}:${clientSecret}` `` ([graphClient.ts:42](artifacts/api-server/src/lib/graphClient.ts#L42)).
**Fix:** `createHash("sha256").update(tuple).digest("hex")` as the map key.
**Accept:** cache hit/miss behaviour unchanged (same-credential reuse, changed-secret invalidation); no raw secret string retained in the key map.

---

## P2 — Dashboard consistency programme (epic)

Item 3.1 (shared `DataTable`/`ExportBtn`/palette/tokens) shipped 2026-07-03 and is verified in the tree. The remaining sub-items below were re-verified open on 2026-07-06.

### 3.2 Standardize loading, error, and empty states — `consistency` `L` **[Opus]**
The single biggest UX defect: **no data tab reads `isError`** — a failed query renders as a healthy-looking empty/zeroed tab (only [App.tsx:48](artifacts/m365-dashboard/src/App.tsx#L48) handles error, for onboarding). Meanwhile `loading = isLoading || isFetching` blanks whole tabs to skeletons on every refetch at 14 sites: [Dashboard.tsx:252](artifacts/m365-dashboard/src/pages/Dashboard.tsx#L252), [AdoptionTab.tsx:168](artifacts/m365-dashboard/src/pages/tabs/AdoptionTab.tsx#L168), [DefenderTab.tsx:318](artifacts/m365-dashboard/src/pages/tabs/DefenderTab.tsx#L318), [ExchangeTab.tsx:22](artifacts/m365-dashboard/src/pages/tabs/ExchangeTab.tsx#L22), [FindingsTab.tsx:67](artifacts/m365-dashboard/src/pages/tabs/FindingsTab.tsx#L67), [FrameworkMappingTab.tsx:91](artifacts/m365-dashboard/src/pages/tabs/FrameworkMappingTab.tsx#L91), [IntuneTab.tsx:732](artifacts/m365-dashboard/src/pages/tabs/IntuneTab.tsx#L732), [LicensesTab.tsx:118](artifacts/m365-dashboard/src/pages/tabs/LicensesTab.tsx#L118), [PowerBITab.tsx:97](artifacts/m365-dashboard/src/pages/tabs/PowerBITab.tsx#L97), [SecurityTab.tsx:276](artifacts/m365-dashboard/src/pages/tabs/SecurityTab.tsx#L276), [ServicePrincipalsTab.tsx:223](artifacts/m365-dashboard/src/pages/tabs/ServicePrincipalsTab.tsx#L223), [UsersTab.tsx:316](artifacts/m365-dashboard/src/pages/tabs/UsersTab.tsx#L316), [EnterpriseAppsSection.tsx:295,701](artifacts/m365-dashboard/src/components/EnterpriseAppsSection.tsx#L295).
**Fix (build shared pieces first, then migrate):**
1. `components/ErrorPanel.tsx` — message + retry button wired to `query.refetch()`; used by every tab when `isError`.
2. `components/TableSkeleton.tsx` — parameterized rows; replaces the ~30 copy-pasted `{[...Array(n)].map(<Skeleton/>)}` blocks (e.g. [FindingsTab.tsx:212](artifacts/m365-dashboard/src/pages/tabs/FindingsTab.tsx#L212), DefenderTab ×6, IntuneTab ×8, UsersTab ×5).
3. Adopt the existing unused [components/ui/empty.tsx](artifacts/m365-dashboard/src/components/ui/empty.tsx) (or a thin `EmptyState` wrapper) for all empty-data messaging; standardize `…` over `...`.
4. Gate skeletons on `isLoading` only; show a subtle inline `isFetching` indicator (e.g. spinner next to the section title).
5. Set a global `staleTime` (≥ 60s) in the query client ([App.tsx:12-18](artifacts/m365-dashboard/src/App.tsx#L12-L18)) — currently 0, compounding the blanking.
6. FindingsTab flash: the PATCH mutation's `onSuccess` invalidate ([FindingsTab.tsx:72](artifacts/m365-dashboard/src/pages/tabs/FindingsTab.tsx#L72)) plus isFetching-driven skeleton re-blanks the register on every status/owner/notes edit — after the gating change verify edits keep the table mounted; also fix the uncontrolled `defaultValue` staleness on Owner/Notes inputs ([FindingsTab.tsx:266,276](artifacts/m365-dashboard/src/pages/tabs/FindingsTab.tsx#L266)) by keying on the server value or switching to controlled inputs.
7. Normalize FrameworkMappingTab's full-tab early-return skeleton ([FrameworkMappingTab.tsx:94-100](artifacts/m365-dashboard/src/pages/tabs/FrameworkMappingTab.tsx#L94-L100)) to per-section.
**Accept:** killing the API mid-session makes every open tab show ErrorPanel with a working retry (not zeros); background refetch no longer blanks any tab; editing a finding doesn't flash the register; dashboard typecheck + build green; grep `isLoading || isFetching` → 0 matches in tabs.

### 3.3 Surface collection issues on every tab — `consistency` `M` **[Sonnet]**
Only Overview, Security, Apps, ServicePrincipals use `summarizeIssues`/`getCollectionIssues` ([lib/collectionStatus.ts](artifacts/m365-dashboard/src/lib/collectionStatus.ts)) with `SectionStatusBanner`. Still ignoring `collectionIssues` (permission failure reads as genuine zero): **Exchange, Users, Licenses, Teams, Compliance, Intune, Adoption, Defender, Findings, FrameworkMapping**. PowerBI reads `collectionIssues[0].message` ad-hoc ([PowerBITab.tsx:130-132](artifacts/m365-dashboard/src/pages/tabs/PowerBITab.tsx#L130-L132)).
**Fix:** apply the existing helpers + banner to each listed tab (pattern to copy: [OverviewTab.tsx:44](artifacts/m365-dashboard/src/pages/tabs/OverviewTab.tsx#L44)); replace PowerBI's inline read with the shared helper.
**Accept:** every tab whose payload carries `collectionIssues` renders `SectionStatusBanner` when issues exist; verified by forcing a permission issue (revoke a scope or stub the payload) on at least Exchange and Intune.

### 3.4 Route all formatting through `lib/utils.ts` — `consistency` `S` **[Sonnet]**
`formatDate` bypassed: [LicensesTab.tsx:80](artifacts/m365-dashboard/src/pages/tabs/LicensesTab.tsx#L80), [DefenderTab.tsx:1000,1211](artifacts/m365-dashboard/src/pages/tabs/DefenderTab.tsx#L1000) (imports it at line 34 yet inlines `toLocaleDateString`). `formatCurrency`, `formatPercent`, `formatNumber` are dead ([utils.ts:9-21](artifacts/m365-dashboard/src/lib/utils.ts#L9-L21)) while LicensesTab hand-builds currency ([LicensesTab.tsx:348,354](artifacts/m365-dashboard/src/pages/tabs/LicensesTab.tsx#L348)) and ~20 sites use raw `.toLocaleString()`.
**Fix:** adopt the helpers at the named sites (and any grep hits for `toLocaleDateString`/`toLocaleString` in tabs where a helper fits); delete any helper that remains unused after adoption.
**Accept:** grep `toLocaleDateString` in `src/pages/tabs` → 0; no dead exports in utils.ts; typecheck green.

### 3.5 Accessibility pass on remaining raw tables — `consistency` `M` **[Sonnet]**
DataTable's a11y is done ([DataTable.tsx:88-131](artifacts/m365-dashboard/src/components/DataTable.tsx#L88-L131): `role="button"`, `tabIndex`, `aria-sort`, Enter/Space, keyboard row-click). But raw `<Table>` instances with clickable/sortable behaviour remain outside it: **Defender ×6, Intune ×6, Security ×5**. DefenderTab's emoji `OsBadge` persists ([DefenderTab.tsx:104-105](artifacts/m365-dashboard/src/pages/tabs/DefenderTab.tsx#L104-L105)) — decorative emoji with no `aria-label`.
**Fix:** migrate the raw tables that have sort/click affordances into `DataTable` where they're plain grids (the review's intentional non-migrations — Exchange domain-auth, PowerBI capacities, expandable Intune/SP drill-downs — stay); for tables that must stay bespoke, add the same `role`/`tabIndex`/`aria-sort`/key-handler treatment. Replace `OsBadge` with the lucide `OSIcon` approach IntuneTab uses ([IntuneTab.tsx:183-190](artifacts/m365-dashboard/src/pages/tabs/IntuneTab.tsx#L183-L190)).
**Accept:** keyboard-only traversal can sort and activate rows in Defender/Intune/Security tables; no bare emoji conveys information without an accessible name; typecheck + build green.

### 3.6 Use the generated API client everywhere — `consistency` `M` **[Sonnet]** *(after 5.3)*
Raw `fetch` bypasses the typed client: [Dashboard.tsx:180,186](artifacts/m365-dashboard/src/pages/Dashboard.tsx#L180) (`fetchCollectionStatus`/`triggerRefresh` — note `triggerRefresh` never checks `resp.ok`, so a 500 leaves the refresh spinner to the 5-min safety timeout, [Dashboard.tsx:332-354](artifacts/m365-dashboard/src/pages/Dashboard.tsx#L332-L354)); [IntuneTab.tsx:601,787,800](artifacts/m365-dashboard/src/pages/tabs/IntuneTab.tsx#L601) (drill-downs); [TeamsSharePointTab.tsx:117,142](artifacts/m365-dashboard/src/pages/tabs/TeamsSharePointTab.tsx#L117).
**Fix:** once 5.3 adds the missing endpoints to the spec, regenerate and consume the typed hooks; fix the unchecked `resp.ok` as part of the migration.
**Accept:** grep `fetch(` in dashboard `src/` → only the sanctioned onboarding client ([onboardingApi.ts:40](artifacts/m365-dashboard/src/lib/onboardingApi.ts#L40)); a failed refresh trigger surfaces an error instead of hanging the spinner.

### 3.7 Consolidate cross-tab duplication — `consistency` `M` **[Sonnet]**
New consolidated item from the review's duplication inventory:
- **Chart theme vars** — identical `gridColor`/`tickColor` dark-mode ternaries in ≥7 tabs ([AdoptionTab.tsx:174-175](artifacts/m365-dashboard/src/pages/tabs/AdoptionTab.tsx#L174), [AppsTab.tsx:61-62](artifacts/m365-dashboard/src/pages/tabs/AppsTab.tsx#L61), [DefenderTab.tsx:426-427](artifacts/m365-dashboard/src/pages/tabs/DefenderTab.tsx#L426), [ExchangeTab.tsx:124-125](artifacts/m365-dashboard/src/pages/tabs/ExchangeTab.tsx#L124), plus Intune/Compliance/Overview) → export a `useChartTheme()` hook from [lib/chartPalette.ts](artifacts/m365-dashboard/src/lib/chartPalette.ts) (or a sibling module).
- **Local palette re-wrappers** — `const C`/`CHART_COLORS` in Defender:42, Intune:55, Security:39, Compliance:23, ServicePrincipals:248, Adoption:27-33 (hardcodes `warning:"#d97706"`), and [EnterpriseAppsSection.tsx:314-316](artifacts/m365-dashboard/src/components/EnterpriseAppsSection.tsx#L314-L316) (re-declares exact palette hexes, recomputed each render) → add `gray` and `warning` to chartPalette and delete the local copies. Also replace the raw hexes in DefenderTab KPI `valueColor`s (972-973, 1183-1184).
- **Label maps** — `CHECK_STATUS_LABEL` re-declared in [FindingsTab.tsx:27-32](artifacts/m365-dashboard/src/pages/tabs/FindingsTab.tsx#L27-L32) (and it drops the `notAssessed` key — a latent bug) → import from [statusTokens.ts](artifacts/m365-dashboard/src/lib/statusTokens.ts); evidence/confidence label maps triplicated in [KPICard.tsx:9-22](artifacts/m365-dashboard/src/components/KPICard.tsx#L9-L22) and [ChecklistTable.tsx:76-89,116-122](artifacts/m365-dashboard/src/components/ChecklistTable.tsx#L76-L89) → single source.
- **Export buttons** — raw inline `<CSVLink>` copies at [ExchangeTab.tsx:195,219](artifacts/m365-dashboard/src/pages/tabs/ExchangeTab.tsx#L195) and [OverviewTab.tsx:160](artifacts/m365-dashboard/src/pages/tabs/OverviewTab.tsx#L160) → `ExportBtn`; drop UsersTab's thin `exportBtn()` wrapper ([UsersTab.tsx:410](artifacts/m365-dashboard/src/pages/tabs/UsersTab.tsx#L410)); replace ExportBtn's hardcoded hex ([ExportBtn.tsx:43](artifacts/m365-dashboard/src/components/ExportBtn.tsx#L43)) with tokens.
- **Severity badges** — DefenderTab inline severity variants (993, 1204) and hardcoded `bg-red-100...` (78, 111) → `SEVERITY_BADGE_CLASS`/tokens (template: SecurityTab's `RiskBadge` at line 84).
**Accept:** grep for `gridColor =`, `const C = {`, `CHECK_STATUS_LABEL` outside statusTokens, `CSVLink` outside ExportBtn → 0 matches in tabs; visual spot-check of one chart per affected tab in light + dark; build green.

---

## P3 — Code quality / DX

### 5.1 Finish unifying the collector styles — `dx` `M` **[Sonnet]**
Partially done (`collectSecurity` migrated). Remaining: [licenses.ts:42-43](artifacts/api-server/src/lib/collectors/licenses.ts#L42-L43) still uses the Graph SDK with **no timeout/retry**; `collectSecurityEstate` still hand-rolls Defender token acquisition + pagination in `fetchDefenderMachinesWithDiagnostics` ([security.ts:33-74](artifacts/api-server/src/lib/collectors/security.ts#L33-L74)).
**Fix:** migrate both to the `collectionIssues.ts` helpers so `graphFetchWithRetry` timeout/retry/issue-capture applies uniformly (Defender's non-Graph host may need a `fetchJsonWithRetry` variant parameterized on base URL + token scope). The DKIM gating and 20-domain note are covered by 1.8.
**Accept:** grep `getGraphClient().api` in collectors → 0; Defender fetch honors `GRAPH_FETCH_TIMEOUT_MS`/`GRAPH_MAX_RETRIES`; collection issues still recorded on failure; existing tests green.

### 5.2 Reduce `any` in the collector/route layer — `dx` `L` **[Opus]**
155 `any` across 18 files (worst: security.ts 37, intune.ts 18, apps.ts 14, servicePrincipals.ts 13, overview.ts 12, powerBI.ts 11) versus zero in the findings engine — whose boundary papers over it with `as IdentityData[...]` / `as never` casts ([engine.ts:48-69](artifacts/api-server/src/lib/findings/engine.ts#L48-L69)).
**Fix:** define typed Graph response shapes per collector (a `graphTypes.ts` per domain or one shared module; type only the fields actually read), type the snapshot payloads end-to-end, and remove the engine boundary casts. Work file-by-file, starting with security.ts since the findings engine consumes it.
**Accept:** `any` count in `src/lib/collectors` + `src/routes` reduced below 30 (grep-counted); no `as never` in engine.ts; typecheck green with no new `@ts-expect-error`.

### 5.3 Finish the OpenAPI spec coverage — `dx` `S` **[Sonnet]**
The findings PATCH, scans, drift, and data-sources endpoints landed in the spec this cycle. Still missing from [openapi.yaml](lib/api-spec/openapi.yaml) but live on the server: all five `/m365/export/*` ([m365Export.ts:17,30,44,57,68](artifacts/api-server/src/routes/m365Export.ts#L17) — binary responses), `/m365/collection-status` and `POST /m365/refresh` ([m365Refresh.ts:7,19](artifacts/api-server/src/routes/m365Refresh.ts#L7)), `/m365/sharepoint/policies` (+meta) ([m365SharePointPolicies.ts:8,18](artifacts/api-server/src/routes/m365SharePointPolicies.ts#L8)), `/m365/sharepoint/sharing-summary` ([m365SharePoint.ts:45](artifacts/api-server/src/routes/m365SharePoint.ts#L45)), `/m365/groups/{id}/device-members` ([m365Groups.ts:149](artifacts/api-server/src/routes/m365Groups.ts#L149)). (`/m365/adoption/debug` may stay off-spec deliberately — note it as internal.)
**Fix:** add the paths (binary endpoints as `application/octet-stream` / appropriate content types), run `pnpm --filter @workspace/api-spec run codegen`, commit regenerated clients. Unblocks 3.6.
**Accept:** every router in [routes/index.ts](artifacts/api-server/src/routes/index.ts) has a spec path (except the documented debug route); codegen diff committed; typecheck green.

### 5.4 ESLint + CI pipeline — `dx` `M` **[Sonnet]**
Confirmed: no ESLint config, no `.github/` at all, `prettier` is a root devDep with no config file (only invoked by orval), no root `test` script, no `.gitattributes` (CRLF/LF churn visible in `git status`).
**Fix:**
1. Flat-config ESLint at root: `typescript-eslint` recommended + `eslint-plugin-react-hooks` (would have caught the 1.6-class bugs) scoped to `artifacts/**`, `lib/**` (excluding `**/generated/**`); add root scripts `lint` and `test` (`pnpm -r --if-present run test`).
2. `.gitattributes` with `* text=auto eol=lf` (and re-normalize).
3. `.github/workflows/ci.yml`: pnpm setup → `pnpm install --frozen-lockfile` → `pnpm typecheck` → `pnpm -r --if-present test` → `pnpm lint` → the 1.9 manifest-JSON freshness check. Note: fix the Windows-only `@rollup/rollup-win32-x64-msvc` dep (5.11) first or CI installs fail on Linux.
**Accept:** `pnpm lint` passes locally (fix or explicitly disable rules on legacy hits — don't blanket-disable react-hooks/exhaustive-deps); CI green on a draft PR; `git status` shows no line-ending warnings after renormalization.

### 5.5 Close the test-coverage gaps — `dx` `L` **[Opus]**
Nine test files exist, all pure-logic (csv, dns, rules subset, coverage rollup, users fallback, admin exposure, onboarding ×3). Zero coverage: every HTTP route (no supertest), `metricStore`/`scanStore`/`findings/store` SQLite logic (regenerate/auto-close/drift/prune/signature), all exports, all collectors, and [findingsRules.test.ts](artifacts/api-server/src/lib/__tests__/findingsRules.test.ts) still skips the **security, compliance, licensing** rule groups. No dashboard test infrastructure at all.
**Priorities (in order):** (1) store tests against in-memory libSQL (`:memory:`) covering `regenerateFindings` atomicity, `ensureFindingsCurrent` signature gating, drift, auto-close; (2) supertest for findings routes (GET/PATCH incl. validation from 2.3) and one export route (incl. the 1.7 unicode fixture); (3) the three missing rule groups; (4) export model/excel/executive smoke tests. Dashboard testing-library setup is a separate later item — don't block on it.
**Accept:** `pnpm --filter @workspace/api-server test` covers all listed areas; rule-group test enumerates every registered rule id and fails if a group is unregistered.

### 5.6 Storage & request-path efficiency — `dx` `S` **[Sonnet]**
- `getFindings` selects all rows then JS-filters severity/status/category ([store.ts:156-158](artifacts/api-server/src/lib/findings/store.ts#L156-L158)) → push to SQL `WHERE`.
- `scanStore.recordScan` inserts history rows one awaited statement at a time with no transaction ([scanStore.ts:49-72](artifacts/api-server/src/lib/scanStore.ts#L49-L72)) → `client.batch(..., "write")`.
- `getFrameworkCoverage()` re-runs full rule evaluation per export, and `getExecutiveModel` calls it **twice** per PDF/HTML ([model.ts:116-118](artifacts/api-server/src/lib/export/model.ts#L116-L118), [model.ts:147](artifacts/api-server/src/lib/export/model.ts#L147)) → compute once per export request.
- `SEVERITY_RANK` duplicated ([model.ts:27](artifacts/api-server/src/lib/export/model.ts#L27), [excel.ts:5](artifacts/api-server/src/lib/export/excel.ts#L5)); `findings.xlsx` and `evidence.xlsx` handlers are byte-identical ([m365Export.ts:30-55](artifacts/api-server/src/routes/m365Export.ts#L30-L55)) → differentiate (evidence = adds evidence columns) or collapse to one route with an alias.
- PATCH findings re-reads the entire register to return one row ([m365Findings.ts:80](artifacts/api-server/src/routes/m365Findings.ts#L80)) → fetch by fingerprint.
- Retry nit: `Math.min(MAX_RETRY_DELAY_MS, retryAfter)` caps a server-provided `Retry-After` at 30s ([collectionIssues.ts:101-104](artifacts/api-server/src/lib/collectionIssues.ts#L101-L104)) → honor server value up to a larger ceiling (e.g. 120s).
**Accept:** SQL-level filtering verified by a store test; `recordScan` is one batch; a single export request triggers exactly one `evaluateFindings` (assert via spy); PATCH returns the row without a full-register read.

### 5.7 Dead-code removal — `dx` `S` **[Sonnet]**
- `backgroundRefresh.getStatus()` superseded by `getStatusAsync` ([backgroundRefresh.ts:127-138](artifacts/api-server/src/lib/backgroundRefresh.ts#L127-L138)).
- ChecklistTable's dead `EvidenceBadge` with its two inner label maps ([ChecklistTable.tsx:75-114](artifacts/m365-dashboard/src/components/ChecklistTable.tsx#L75-L114)) and the ignored `_notesInSeparateColumn` prop ([ChecklistTable.tsx:124](artifacts/m365-dashboard/src/components/ChecklistTable.tsx#L124)).
- `cookie-parser` + `@types/cookie-parser` unused ([api-server package.json](artifacts/api-server/package.json)) — never imported, never registered.
- Fix the misleading CE-themes comment ([catalogue.ts:9](artifacts/api-server/src/lib/findings/frameworks/catalogue.ts#L9)) — or leave for 6.5 which adds the missing FW control; coordinate, don't double-fix.
- Any formatting helpers still dead after 3.4.
**Accept:** grep confirms zero references before each deletion; typecheck + tests green; `pnpm install` lockfile updated for the dep removal.

### 5.8 Stop presenting hardcoded-zero Exchange metrics as data — `dx` `S` **[Sonnet]**
`sharedMailboxes` and `roomMailboxes` are always 0 ([exchange.ts:29-30,128](artifacts/api-server/src/lib/collectors/exchange.ts#L29-L30)); `quarantinedMessages`/`malwareDetected`/`spamFiltered` are hardcoded 0 ([exchange.ts:135](artifacts/api-server/src/lib/collectors/exchange.ts#L135)). These render as genuine zeros in the UI.
**Fix:** either collect them (shared/room mailboxes are derivable from the mailbox-usage report's `recipientType` if present; quarantine/malware need Defender for Office APIs — likely not now) or make them `null`/absent, mark the metrics `notAssessed`/`manual` in [manifest.ts](lib/permissions-manifest/src/manifest.ts), and let the KPI cards show the evidence state instead of 0. Prefer the latter for this item.
**Accept:** ExchangeTab shows "not assessed"/manual-check treatment (not `0`) for these metrics; manifest regenerated; no type errors in the generated clients (spec updated if the shape changes).

### 5.9 Stable synthetic device identifiers — `dx` `S` **[Sonnet]**
Non-AAD Intune/MDE devices get `intune:${md.id ?? Math.random()}` / `mde:${...}` keys ([security.ts:427,454,512](artifacts/api-server/src/lib/collectors/security.ts#L427)); a missing `id` yields unstable keys across runs → phantom drift.
**Fix:** derive a deterministic fallback (hash of name+OS+enrolledDateTime or similar stable tuple); if nothing stable exists, exclude from drift-keyed identity and log a collection note.
**Accept:** two consecutive collections over identical fixture data produce identical device keys (unit test with `id` absent).

### 5.10 Docs & repo hygiene — `dx` `S` **[Sonnet]**
- [replit.md](replit.md) is materially wrong: claims PostgreSQL + Drizzle (actual: libSQL/SQLite via `@libsql/client`), node-cache 5-min caching (actual: libSQL metric store, 1h TTL, 30-min background tick), 10 route files (actual: 27), zod v4 (catalog pins v3).
- [README.md](README.md) says Node 18+, replit.md says 24; **no `engines` field anywhere** — pick one (24), enforce it in root package.json.
- No `.env.example`; undocumented env vars actually read: `PORT`, `NODE_ENV`, `LOG_LEVEL`, `GRAPH_FETCH_TIMEOUT_MS`, `GRAPH_MAX_RETRIES`, `METRIC_DB_PATH`, `SCAN_HISTORY_LIMIT`, `ONBOARDING_SETTINGS_PATH`, `ONBOARDING_SETTINGS_DIR` (+ `HOST`, `CORS_ALLOWED_ORIGINS`, `ALLOWED_HOSTS`, and 2.2's `ALLOW_REMOTE` once it lands).
- `.gitignore` lacks `*.db` — `METRIC_DB_PATH` pointed inside the tree would be committable.
**Fix:** rewrite replit.md's architecture section from the actual code; add `.env.example` with comments; add `engines` to root + both apps; append `*.db` to .gitignore. (`.gitattributes` is in 5.4.)
**Accept:** every `process.env` read in api-server appears in `.env.example`; replit.md spot-checked against metricStore/backgroundRefresh constants; `pnpm install` warns on wrong Node major.

### 5.11 Dependency hygiene — `dx` `S` **[Sonnet]**
- Dashboard: runtime libs (`react`, `react-dom`, `wouter`, `recharts`, `@tanstack/react-query`, all `@radix-ui/*`) misfiled under `devDependencies` while `dependencies` holds five packages ([m365-dashboard package.json](artifacts/m365-dashboard/package.json)) — move runtime deps to `dependencies`.
- `@rollup/rollup-win32-x64-msvc` listed as a hard dep — **breaks non-Windows installs (and the 5.4 CI)**; move to `optionalDependencies` or delete (pnpm resolves platform binaries automatically).
- Duplicate CSV stacks: `papaparse` + `react-csv` (+ both `@types`) — converge on one (ExportBtn already centralizes usage; pick its dependency and migrate the other's call sites).
- api-server: `cookie-parser` removal is 5.7; review the exact `thread-stream: 3.1.0` pin (document why or re-range); `express: "^5"` / `cors: "^2"` major-only ranges — tighten to current minors.
**Accept:** fresh `pnpm install` on Linux (or CI) succeeds; `pnpm build` green; one CSV library remains.

---

## Feature enhancements

### 6.1 Authoritative Exchange Online DKIM via certificate-based app auth — `feature` `M` **[Opus]**
Unchanged from previous draft; now pairs with 1.8 (which stops the failed attempt when no cert is configured). App-only EXO access requires **certificate-based auth** + `Exchange.ManageAsApp` + a directory role; the app authenticates with `ClientSecretCredential` ([graphClient.ts](artifacts/api-server/src/lib/graphClient.ts)), so the EXO path 401s and DKIM falls back to DNS ("(DNS)" in the UI).
**Scope:** optional `ClientCertificateCredential` alongside the secret flow (cert path/thumbprint via onboarding settings — coordinate with 2.1's at-rest protection); the `outlook.office365.com/.default` scope and `InvokeCommand` plumbing already exist in [exchangeOnline.ts](artifacts/api-server/src/lib/exchangeOnline.ts) — the gap is purely the credential type; document required app setup; DNS fallback remains when unconfigured. Manifest already models this as the `exchange-advanced` future feature.
**Accept:** with a cert configured, DKIM rows show `dkimSource: "exchange"`; without, behaviour identical to today post-1.8; setup documented in README.

### 6.2 Per-host concurrency limiting for Graph collection — `feature` `M` **[Opus]**
Bounded retry with `Retry-After` shipped (`graphFetchWithRetry`). Remaining production-hardening: the 19 background-refresh tasks fan out with **uncapped concurrency** — e.g. one `transitiveMembers` request per unknown principal ([adminExposure.ts:246-257](artifacts/api-server/src/lib/collectors/adminExposure.ts#L246-L257)), same pattern at [security.ts:110-123](artifacts/api-server/src/lib/collectors/security.ts#L110-L123) — so large tenants self-inflict 429 storms.
**Scope:** a small semaphore/queue (per host: graph.microsoft.com, api.securitycenter.microsoft.com) inside the fetch helpers, default ~8 concurrent, env-tunable; jittered backoff already exists.
**Accept:** a fixture test proves ≤N in-flight requests under a 100-item fan-out; full refresh on a large tenant completes without unretried 429s.

### 6.3 Per-tab URL routing and deep links — `feature` `M` **[Opus]**
Tabs are `activeTab` state ([Dashboard.tsx:245](artifacts/m365-dashboard/src/pages/Dashboard.tsx#L245)); section deep-linking is a window `CustomEvent` ("m365:open-section", dispatched [Dashboard.tsx:367](artifacts/m365-dashboard/src/pages/Dashboard.tsx#L367), received [CollapsibleSection.tsx:66-75](artifacts/m365-dashboard/src/components/CollapsibleSection.tsx#L66-L75)). Wouter is installed but only routes `/` ([App.tsx:61](artifacts/m365-dashboard/src/App.tsx#L61)).
**Scope:** `/tab/:tab` (+ optional `#section` scroll) so views are shareable and back/forward works; replace the CustomEvent mechanism with navigation; keep `visitedTabs` mount-gating semantics.
**Accept:** reloading `/tab/intune` lands on Intune; back/forward walks tab history; cross-tab "open section" links still scroll to the section.

### 6.4 Optional API auth token for non-localhost deployment — `feature` `M` **[Opus]**
Pairs with 2.2: bearer token generated at onboarding, stored with settings (under 2.1's protection), checked by middleware when `HOST` is non-loopback; plus basic rate limiting. Unlocks shared-host deployment.
**Accept:** non-loopback + token set → 401 without header, 200 with; loopback behaviour unchanged; token never logged.

### 6.5 Complete the framework catalogue — `feature` `S` **[Sonnet]**
- The NCSC Cyber Essentials **firewall (FW) theme is still missing**: [catalogue.ts:9](artifacts/api-server/src/lib/findings/frameworks/catalogue.ts#L9) promises five themes; only UAC/SC/MPM/SUM are defined ([catalogue.ts:115-142](artifacts/api-server/src/lib/findings/frameworks/catalogue.ts#L115-L142)) — CE coverage can never reach FW. Add the control and map at least one rule (e.g. a Defender firewall-policy or Intune baseline rule) or mark it `notAssessed`-by-design with a manual check.
- **Dangling-ref guard:** findings referencing an undefined control are silently dropped in rollup ([coverage.ts:50-53](artifacts/api-server/src/lib/findings/frameworks/coverage.ts#L50-L53)); add a test asserting every `cis()`/`ce()` reference across all rule modules resolves to a defined control (and optionally a runtime warn).
- Expand CIS mappings beyond the current 11 controls.
- Manifest endpoint-version nit: `RecordsManagement.Read.All` documents `/security/labels/retentionLabels` ([manifest.ts:351](lib/permissions-manifest/src/manifest.ts#L351)) while the metric registry lists the `/beta/` variant ([manifest.ts:1148](lib/permissions-manifest/src/manifest.ts#L1148)) — reconcile with what the collector actually calls.
**Accept:** five CE themes defined; the resolve-all-refs test exists and passes; coverage UI shows FW; manifest versions reconciled + JSON regenerated.

### 6.6 Scan-history UI: trends and drift timeline — `feature` `L` **[Opus]**
Backend already archives per-scan snapshots and findings (`scan_runs`, `findings_history`, `computeDrift`) and the spec now exposes `/m365/scans`, `/m365/scans/{id}`, `/m365/drift`. Surface it: a history view with severity trend lines across scans, a drift timeline between arbitrary scan pairs, and per-finding first-seen/resolved history — turning the register into an evidenceable audit trail. Note the archive stores summary-level rows (mostly blank detail fields, [model.ts:78-96](artifacts/api-server/src/lib/export/model.ts#L78-L96)) — either archive more columns first or label scan-scoped views summary-only.
**Accept:** a new History tab (registered in Dashboard's tab list) renders trend + drift from the typed hooks; drift between two chosen scans matches `computeDrift` output; loading/error states use the 3.2 components.

### 6.7 Lazy-load tabs and trim the entry bundle — `feature` `M` **[Sonnet]**
All 15 tab modules are statically imported ([Dashboard.tsx:15-29](artifacts/m365-dashboard/src/pages/Dashboard.tsx#L15-L29)); `visitedTabs` defers mounting but not code download, so IntuneTab (~2,400 lines), DefenderTab (~1,200), EnterpriseAppsSection and 9 tabs' worth of Recharts all ship in the entry chunk.
**Fix:** `React.lazy` each tab + one `Suspense` boundary (fallback: 3.2's `TableSkeleton`) at the tab-render site; verify Recharts splits into the lazy chunks; keep the `visitedTabs` keep-alive behaviour (lazy component stays mounted once visited).
**Accept:** production build shows per-tab chunks and a materially smaller entry chunk (record before/after sizes in the PR); tab switching still preserves state; no hydration/remount regressions on refresh.

---

## Completed

| Date | Item |
|------|------|
| 2026-07-02 | 1.1 RFC-4180 CSV parser ([csv.ts](artifacts/api-server/src/lib/csv.ts)) replacing naive split; fixture tests |
| 2026-07-02 | 1.2 findings regeneration atomic (`client.batch`) + single-flight + snapshot-signature gating (`ensureFindingsCurrent`) |
| 2026-07-02 | 1.3 `dueDate` 400 on unparseable input (interim; superseded by 2.3) |
| 2026-07-02 | 1.4 `graphFetchWithRetry`: bounded retries honoring `Retry-After`, jittered backoff |
| 2026-07-02 | 1.5 query invalidation scoped via `invalidateM365Data` predicate |
| 2026-07-02 | 1.6 `fieldMetadata` memoized + dep fixed; `teamsBySizeBreakdown` memoized |
| 2026-07-03 | 3.1 shared `DataTable` (a11y built in), `ExportBtn`, `chartPalette`, `statusTokens`; 11 tabs migrated; bundle −22 KB |
| 2026-07-06 | 5.3 (partial) findings PATCH, `/m365/scans`, `/m365/drift`, `/m365/data-sources` added to openapi.yaml + clients regenerated |
