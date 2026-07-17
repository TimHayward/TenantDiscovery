# Backlog

Redrafted from the full code review of the working tree on **2026-07-06** (three-agent review: api-server, dashboard, cross-cutting infrastructure). Supersedes the 2026-07-02 draft; resolved items are compressed into the [Completed](#completed) changelog at the bottom. Items graduate into [ROADMAP.md](ROADMAP.md) sprints when picked up.

**Re-verified 2026-07-09** against commits `f8cbfa8` (Docker compose + working-tree commit), `f777217` (settings page), `0e73a0f` (permission reporting fix): items 1.7, 1.8, 1.9, 3.2, 3.4, 3.7, 5.3, and 6.5 are confirmed done against their Accept criteria and moved to Completed.

**2026-07-10:** the remainder of the "This Week" sequence (2.2, 2.3, 2.4, 2.5, 3.3, 5.4) landed. Correction to the prior entry: 3.3 was actually ~93% done already (14 of 15 data tabs wire `issue={...}` into `CollapsibleSection`, which renders `SectionStatusBanner` internally — the 2026-07-09 re-verification grepped only for the literal component name and missed that delegation pattern); only PowerBI needed the fix. **Caveat: this environment has no Node.js/pnpm available, so none of today's changes have been run through `pnpm typecheck`/`test`/`lint` or built — review before merging.** New/moved dependencies (`helmet`, root `eslint`/`typescript-eslint`/`eslint-plugin-react-hooks`, `@rollup/rollup-win32-x64-msvc` moved to `optionalDependencies`) mean `pnpm-lock.yaml` is now stale — run `pnpm install` first, which will also make `pnpm install --frozen-lockfile` in the new CI workflow pass.

**2026-07-10 (later):** 3.5 and 3.6 closed out. Both were found mostly done already in the working tree (the 2026-07-06 anchors were stale): all sortable/clickable bespoke tables already carried `sortableHeadA11yProps`/keyboard row handlers, `OsBadge` was already lucide-based, and Dashboard/Intune/TeamsSharePoint were already on the generated hooks with `postM365Refresh`. Today's remainder: migrated the last three plain-grid tables (Defender endpoint/office alerts, Security risky-users) into `DataTable` (dead `ui/table` imports removed), gave ServicePrincipalsTab's bare `⚠` glyphs accessible names, and made a failed refresh trigger surface a destructive toast instead of silently clearing the spinner. **Same caveat as above: no Node.js/pnpm in this environment, so not typechecked/tested — verify before merging.** Also noticed 6.7 (lazy-loaded tabs) is already implemented in Dashboard.tsx — left open pending a build to record chunk sizes.

**How to read:** each item carries a priority (**P1** fix now / **P2** next batch / **P3** opportunistic), an effort estimate (**S** < half a day, **M** ~1–2 days, **L** multi-day), tags (`bug`, `security`, `consistency`, `dx`, `feature`), and a suggested execution model — **[Opus]** for architectural / multi-file / judgment-heavy work, **[Sonnet]** for mechanical, well-specified changes. Every item ends with **Accept:** criteria an agent can verify. File anchors reference the working tree as of 2026-07-06.

---

## This Week (proposed)

All six steps (W0 commit the working tree; W1 2.3 zod validation; W2 2.2 `ALLOW_REMOTE` + helmet; W3 2.4 CSV injection guard; W4 2.5 hash cache key; W5 3.3 banner rollout; W6 5.4 ESLint + CI) are done — see [Completed](#completed). Next up is whatever's picked from P2/P3 below; 2.1 (secrets-at-rest) is the largest remaining security item.

---

## P1 — Correctness

All P1 items (1.7 PDF WinAnsi crash, 1.8 DKIM gating, 1.9 manifest regeneration + freshness guard) are done — see [Completed](#completed).

---

## P2 — Security hardening

The strong baseline noted in the last review still holds (loopback-only default, no committed secrets, redaction sentinels, parameterized SQL, DoH-only DNS, escaped HTML export, in-memory export generation). These items are hardening on top.

2.2, 2.3, 2.4, and 2.5 are done — see [Completed](#completed).

### 2.1 Protect secrets and tenant PII at rest on Windows — `security` `M` **[Opus]**
`onboarding-settings.json` holds the Azure client secret in cleartext; `chmod 0600` applies only on non-Windows ([setupConfig.ts:128-131](artifacts/api-server/src/lib/setupConfig.ts#L128-L131)). `metrics.db` stores full tenant PII with no permission hardening on any platform ([metricStore.ts:31-34](artifacts/api-server/src/lib/metricStore.ts#L31-L34)).
**Fix:** at file-creation time apply owner-only Windows ACLs (`icacls <file> /inheritance:r /grant:r "%USERNAME%":F` via `child_process`, or a small native-free helper) to both files; `0600` the DB on POSIX; evaluate DPAPI (`CryptProtectData`) for the secret value itself and document the decision + residual risk in README.
**Accept:** on Windows, `icacls` output for both files shows only the owning user; on POSIX both are `0600`; secret round-trips through save/load; `setupConfig.test.ts` extended to assert the hardening hook is invoked (mock the platform call).

---

## P2 — Dashboard consistency programme (epic)

The epic is complete: 3.1 shipped 2026-07-03; 3.2, 3.3, 3.4, 3.5, 3.6, and 3.7 are done — see [Completed](#completed).

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

5.4 (ESLint + CI) is done — see [Completed](#completed). One follow-up remains: `.gitattributes` was added but the repo hasn't been re-normalized yet (`git add --renormalize .`) — deliberately deferred since it touches every text file's line endings in one large diff; do it as its own reviewed commit when convenient.

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
- ~~`@rollup/rollup-win32-x64-msvc` listed as a hard dep~~ — done 2026-07-10, moved to `optionalDependencies` as part of unblocking the 5.4 CI.
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

### 6.6 Scan-history UI: trends and drift timeline — `feature` `L` **[Opus]**
Backend already archives per-scan snapshots and findings (`scan_runs`, `findings_history`, `computeDrift`) and the spec now exposes `/m365/scans`, `/m365/scans/{id}`, `/m365/drift`. Surface it: a history view with severity trend lines across scans, a drift timeline between arbitrary scan pairs, and per-finding first-seen/resolved history — turning the register into an evidenceable audit trail. Note the archive stores summary-level rows (mostly blank detail fields, [model.ts:78-96](artifacts/api-server/src/lib/export/model.ts#L78-L96)) — either archive more columns first or label scan-scoped views summary-only.
**Accept:** a new History tab (registered in Dashboard's tab list) renders trend + drift from the typed hooks; drift between two chosen scans matches `computeDrift` output; loading/error states use the 3.2 components.

### 6.7 Lazy-load tabs and trim the entry bundle — `feature` `M` **[Sonnet]**
**2026-07-10 note: the implementation has already landed** — all 16 tabs are `React.lazy` chunks with `visitedTabs` keep-alive ([Dashboard.tsx:28-43](artifacts/m365-dashboard/src/pages/Dashboard.tsx#L28-L43)). Remaining: run a production build to verify Recharts splits into the lazy chunks and record the entry-chunk size, then close.
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
| 2026-07-08 | 1.7 `toWinAnsi()` sanitizer in executive.ts routed through every `drawText`; `executivePdf.test.ts` covers CJK/emoji + Latin-1 |
| 2026-07-08 | 1.8 Exchange DKIM call gated on `isExchangeCertAuthConfigured()`; DNS fallback preserved; 20-domain cap surfaced as a collection note |
| 2026-07-08 | 3.2 `ErrorPanel`/`TableSkeleton` shared components; `isLoading \|\| isFetching` blanking pattern eliminated from all tabs |
| 2026-07-08 | 3.4 `toLocaleDateString`/`toLocaleString` eliminated from `src/pages/tabs`; formatting routed through `lib/utils.ts` |
| 2026-07-08 | 3.7 `useChartTheme()` hook consolidates chart gridline/tick theming; `statusTokens.ts` is sole source for `CHECK_STATUS_LABEL` |
| 2026-07-08 | 5.3 (remainder) `/m365/export/*`, `/m365/collection-status`, `/m365/refresh`, sharepoint policies/sharing-summary, groups device-members added to spec |
| 2026-07-09 | 1.9 `permissions.manifest.json` regenerated; `manifestJson.test.ts` freshness guard; every metric has a `confidenceLabel` |
| 2026-07-09 | 6.5 NCSC CE firewall (FW) theme + rule added; dangling-ref guard test; CIS mappings expanded 11→19; manifest endpoint-version nit reconciled |
| 2026-07-10 | 2.2 `assertSafeBinding(host, env)` pure guard refuses non-loopback `HOST` without `ALLOW_REMOTE=true`; `helmet` added to app.ts |
| 2026-07-10 | 2.3 `middlewares/validate.ts` (zod `safeParse` → 400) applied to every route reading body/query/params (onboarding, findings, exports, groups, intune, permissions, scans, data-sources); `acknowledgedMissingPermissions` gap in the onboarding spec closed |
| 2026-07-10 | 2.4 `sanitizeCsvCell` prefixes formula-triggering cells with `'` in both the server CSV serializer and the dashboard's `ExportBtn` |
| 2026-07-10 | 2.5 Graph client cache key hashed with `sha256` instead of storing the raw secret |
| 2026-07-10 | 3.3 PowerBI's last gap closed (`issue` now passed to its `CollapsibleSection`) — all 15 data tabs surface collection issues |
| 2026-07-10 | 5.4 flat-config ESLint (`typescript-eslint` + `eslint-plugin-react-hooks`) at root, `.gitattributes`, `.github/workflows/ci.yml`; unblocked by moving `@rollup/rollup-win32-x64-msvc` to `optionalDependencies` (5.11) |
| 2026-07-10 | 3.5 last three plain-grid tables (Defender endpoint/office alerts, Security risky-users) migrated to `DataTable`; bespoke sortable tables already had `sortableHeadA11yProps`; `OsBadge` already lucide; SP `⚠` glyphs given accessible names |
| 2026-07-10 | 3.6 generated hooks already consumed everywhere (`fetch(` grep → only onboardingApi.ts); added destructive toast when the refresh trigger fails (spinner already cleared via `postM365Refresh` throw) |
