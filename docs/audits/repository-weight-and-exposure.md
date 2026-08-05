# Repository weight and data-exposure audit

Status: report only. No source, configuration or asset file was changed to produce this
document. All commands below were run against `agent/t03` (a worktree of `TimHayward/TenantDiscovery`,
a **public** GitHub repository — confirmed via `git remote -v`), branched from `main` at commit
`5626990`.

No file inside `attached_assets/` was opened, extracted, transcribed or summarised. Every claim
about those files below comes from three sources only: the filename, the `file` utility (which
reads container metadata — dimensions, page count, format — not document content), and git's
own object metadata (hash, size, commit, date).

## TL;DR

- `attached_assets/` (7.49 MB across 9 tracked files) and one duplicate 436 KB PNG under
  `.canvas/` are dead weight: nothing in the codebase imports or requires them, and together
  they are **86.5% of the repository's pack size**. They were all committed on the same day
  (2026-05-02), in five commits, apparently as Replit Agent chat artefacts (pasted screenshots,
  pasted prompt text, and an "Example" tenant assessment report + spreadsheet).
- The one open question that matters: **is the "Example M365 Tenant Assessment Report" example
  data, or is it a real customer's tenant?** That single yes/no answer determines everything
  else in this document. Nobody but a human who was present when it was added can answer it.
- `replit.md` is confirmed materially wrong on all four claims the backlog flagged (database,
  caching, route count, Zod version). Recommend: correct it, don't delete it — it is currently
  the only architecture-orientation document in the repository.
- The repository has no `LICENSE` (despite `package.json` claiming MIT), no `SECURITY.md`, no
  `CONTRIBUTING.md`, no `CODEOWNERS`. For a public repo whose product authenticates to Microsoft
  Graph with application credentials, `SECURITY.md` is the one to write first. A draft is
  included below.
- `.replit`, `.replitignore` and two of the three `@replit/vite-plugin-*` packages
  (`cartographer`, `dev-banner`) are inert outside a Replit environment — they are guarded by
  `REPL_ID` and no-op elsewhere. `@replit/vite-plugin-runtime-error-modal` is not guarded; it
  loads unconditionally in both Vite configs that import it.
- My recommendation on the large assets: **do not rewrite history yet.** Move the two
  `attached_assets` chat artefacts you don't need for anything (the Pasted-*.txt prompts, the
  four screenshots, the .canvas duplicate) to the tip-only removal first, and hold the
  history rewrite until the exposure question above is answered — because if the answer turns
  out to be "yes, real tenant data," the remediation command differs (see §5) and you would
  rather run it once than twice.

---

## 1. Inventory

### 1.1 Repository size

| Measure | Bytes | Approx. | Command |
|---|---|---|---|
| `.git` (object store, both packs + loose) | 8,537,566 | 8.5 MB | `du -sb "<repo>/.git"` |
| Working tree, tracked files only | 10,700,518 | 10.7 MB | `git ls-files -z \| xargs -0 du -b \| awk '{s+=$1} END{print s}'` |
| Combined (clone + checkout footprint) | 19,238,084 | 19.2 MB | sum of the two above |
| `attached_assets/` (tracked, 9 files) | 7,485,667 | 7.49 MB (7.2 MiB, matching `du -sh`) | `git ls-files -z attached_assets \| xargs -0 du -cb \| tail -1` |
| `.canvas/` (tracked, 1 file) | 436,142 | 436 KB | `du -sb .canvas` |

This worktree is one of several checked out from a single `.git` directory
(`C:/GitHub/TenantDiscovery/.git`, shared via `git worktree`), which is why `.git` inside this
worktree shows as 1 KB — `cat .git` shows it is a pointer file; the real object store was
located with `git rev-parse --git-common-dir` before measuring.

### 1.2 Pack composition

```
$ git count-objects -v
count: 97
in-pack: 2021
packs: 2
size-pack: 7661   # KiB, both packs combined
```

```
$ git verify-pack -v <repo>/.git/objects/pack/*.idx | tail -5
non delta: 112 objects
chain length = 1: 22 objects
chain length = 2: 2 objects
```

Summed in-pack (compressed) bytes across all 2021 objects in both packs: **7,787,052 bytes.**
Summed in-pack bytes of the ten largest objects: **6,732,753 bytes — 86.5% of the pack.**

```
$ git verify-pack -v <repo>/.git/objects/pack/*.idx \
    | grep -E '^[0-9a-f]{40} (blob|commit|tree|tag)' \
    | sort -k4 -n -r | head -10
```

| Rank | Path | Blob (uncompressed) | In-pack (compressed) |
|---|---|---|---|
| 1 | `attached_assets/Example_M365_Tenant_Assessment_Report_...pdf` | 5,654,113 | 5,066,518 |
| 2 | `attached_assets/image_1777756234001.png` | 553,825 | 508,325 |
| 3 | `.canvas/assets/asset_1437002127.png` | 436,142 | 393,231 |
| 4 | `attached_assets/Example_M365_Tenant_Assessment_Report_...xlsx` | 396,174 | 372,782 |
| 5 | `attached_assets/image_1777754866653.png` | 410,777 | 144,245 |
| 6 | `pnpm-lock.yaml` (historical version) | 311,399 | 88,708 |
| 7 | `pnpm-lock.yaml` (historical version) | 279,101 | 85,794 |
| 8 | `artifacts/m365-dashboard/.../IntuneTab.tsx` (historical) | 126,944 | 28,550 |
| 9 | `lib/permissions-manifest/src/manifest.ts` (historical) | 129,337 | 22,532 |
| 10 | `artifacts/m365-dashboard/.../IntuneTab.tsx` (historical) | 125,577 | 22,068 |

Rows 1–5 (the assets in question) alone are **6,484,101 in-pack bytes — 83.3% of the pack** by
themselves. Rows 6–10 are ordinary source-control churn: old versions of `pnpm-lock.yaml`,
a generated manifest, and a large dashboard tab component, all superseded by smaller current
versions and not an exposure question — normal history weight, not addressed further here.

### 1.3 Every committed file over 100 KB (by path, from full history)

Method, per the brief: walk every object ever committed on any ref, not just the working tree,
because a file removed at the tip still lives in the pack.

```
$ git rev-list --objects --all > all_objects.txt
$ git cat-file --batch-check='%(objecttype) %(objectname) %(objectsize) %(rest)' < all_objects.txt \
    > batch_check.txt
$ awk '$1=="blob" && $3+0 > 102400 {print}' batch_check.txt | sort -k3 -nr
```

This returns 41 blob objects over 100 KB, resolving to 10 distinct paths. Grouped:

**Exposure-relevant (single version each, still in the tree, this is the actual finding):**

| Path | Size | Type | Introducing commit | Date |
|---|---|---|---|---|
| `attached_assets/Example_M365_Tenant_Assessment_Report_15.12.2025_1777735069625.pdf` | 5,654,113 B | PDF 1.3, 20 pages | `0d17a09` "Add example files for M365 health dashboard project" | 2026-05-02 |
| `attached_assets/Example_M365_Tenant_Assessment_Report_15.12.2025_1777735069624.xlsx` | 396,174 B | Excel 2007+ (xlsx) | `0d17a09` (same commit) | 2026-05-02 |
| `attached_assets/image_1777756234001.png` | 553,825 B | PNG, 2864×1588 RGB | `060e6a3` "Correctly identify compromised devices and display their status" | 2026-05-02 |
| `attached_assets/image_1777754866653.png` | 410,777 B | PNG, 2864×1588 RGB | `57da9c0` "Update M365 dashboard to correctly display Intune and compliance data" | 2026-05-02 |
| `.canvas/assets/asset_1437002127.png` | 436,142 B | PNG, 2864×1588 RGB (**byte-identical to `attached_assets/image_1777755009692.png`** — same git blob hash `e18bda58...`) | `57da9c0` (same commit) | 2026-05-02 |

**Ordinary churn (superseded by smaller current versions, contributes to pack weight only, no
exposure question):**

| Path | Versions > 100 KB in history | Current size | First >100 KB commit |
|---|---|---|---|
| `pnpm-lock.yaml` | 9 | 320,764 B | `0d17a09` |
| `lib/permissions-manifest/src/manifest.ts` | 10 | 146,403 B | (generated file, regenerated repeatedly) |
| `artifacts/m365-dashboard/src/pages/tabs/IntuneTab.tsx` | 9 | 125,577 B | (edited repeatedly) |
| `lib/api-client-react/src/generated/api.ts` | 5 | 145,766 B | (generated, regenerated) |
| `lib/api-spec/openapi.yaml` | 2 | 111,404 B | (edited) |

Reproduce with `git log --diff-filter=A --format='%H %ad %s' --date=short -- <path>` per file
(returns the first add; several of the churn files above have been added, deleted and re-added
across renames, so "first commit" is approximate for those five and not load-bearing for this
audit — they are not the exposure question).

Two more `attached_assets` files sit just under the 100 KB threshold and are covered in §2
because the brief asks for them by name regardless of size:
`image_1777755009692.png` (436,142 B — this *is* over 100 KB; it's the twin of the `.canvas`
duplicate above, both from blob `e18bda58...`) and `image_1777757306118.png` (17,367 B).

---

## 2. Exposure assessment

For every item: what it looks like from outside, whether the codebase references it, whether
it's needed, and the yes/no question a human needs to answer.

### `attached_assets/Example_M365_Tenant_Assessment_Report_15.12.2025_*.pdf` (5.65 MB) and
### `attached_assets/Example_M365_Tenant_Assessment_Report_15.12.2025_*.xlsx` (396 KB)

- **Appears to be:** a 20-page PDF report and a companion spreadsheet, both named
  "Example M365 Tenant Assessment Report," dated 15.12.2025 in the filename, added in the same
  commit as a pair.
- **Referenced in code?** No. `grep -rn "Example_M365_Tenant_Assessment" .` (excluding
  `attached_assets/` itself) returns nothing.
- **Needed for build/tests/docs?** No. Neither file is imported, read, or mentioned by any
  build script, test, or markdown file in the repository.
- **The question:** *Does this PDF/spreadsheet pair describe a real customer's Microsoft 365
  tenant, rather than synthetic or anonymised example data?*

### `attached_assets/image_1777754866653.png`, `image_1777756234001.png`, `image_1777755009692.png` (410–554 KB each, 2864×1588)

- **Appears to be:** three full-resolution screenshots, filenames matching the pattern Replit's
  Agent chat uses for pasted images (`image_<epoch-ms>.png`), added across three separate
  commits on 2026-05-02 alongside dashboard feature work.
- **Referenced in code?** No.
- **Needed for build/tests/docs?** No.
- **The question:** *Do any of these three screenshots show real tenant data — user names,
  domain names, license counts, security findings — captured from a live dashboard session,
  rather than a mocked or seeded demo tenant?*

### `attached_assets/image_1777757306118.png` (17 KB, 1035×191)

- **Appears to be:** a small UI crop (icon strip or button row), not a full screenshot,
  added in the same commit as the two `Pasted-*` prompt files below.
- **Referenced in code?** No. **Needed?** No.
- **The question:** same shape as above, lower risk given the small crop dimensions, but not
  zero — *does it show any real identifying text?*

### `.canvas/assets/asset_1437002127.png` (436 KB) — **duplicate**

- **Appears to be:** confirmed byte-identical (`git hash-object` returns the same SHA,
  `e18bda587bef502e81ec03960a54de146425e031`) to `attached_assets/image_1777755009692.png`
  above. There is no `.canvas` index file tracked anywhere in the repository — this asset is
  orphaned; nothing references it, not even a canvas.
- **Referenced in code?** No — `.dockerignore` excludes the whole `.canvas/` directory from
  Docker build contexts, but nothing includes it.
- **Needed for build/tests/docs?** No.
- **The question:** same as its twin — resolving one resolves both, since they are the same
  bytes under two paths.

### `attached_assets/Pasted--1-Entra-ID-Users-Identity-...1777757035997.txt` and `...1777757045515.txt` (6.3 KB each)

- **Appears to be:** two pasted-text files, 6,264 bytes each, filenames matching Replit's
  "Pasted-\<slugified-first-line\>-\<epoch\>.txt" pattern for long chat pastes. The shared
  filename stem ("1-Entra-ID-Users-Identity-1-1-Multi-factor-authenticat...") and near-identical
  epoch suffixes (10 seconds apart) suggest these are two versions of the same paste, not two
  different pastes — worth checking with `diff` if anyone opens them, which this audit does not do.
- **Referenced in code?** No. **Needed?** No.
- **The question:** *Do either of these two text pastes contain tenant-identifying details
  (a real tenant name, real user principal names, a real domain) copied in from a live session,
  as opposed to being pure feature-request prompt text (which the filenames suggest)?*

### `attached_assets/Pasted-In-the-Users-and-Identity-tab-...1777759123607.txt` (4.7 KB)

- Same pattern, same questions, added roughly two days later than the pair above (per its own
  commit — `ebd1d38`, same date 2026-05-02, later in the day by clock time within that commit).

### `@assets` Vite alias

`artifacts/m365-dashboard/vite.config.ts:52` defines
`"@assets": path.resolve(..., "attached_assets")`. This is the *only* reference to
`attached_assets` anywhere in source code, and it is a directory alias, not an import — nothing
in `artifacts/m365-dashboard/src` actually imports through `@assets/...` (`grep -rn "@assets"`
returns only the alias definition itself). The alias is unused dead configuration, separate
from the exposure question but relevant to "is anything load-bearing": no, the dashboard would
build identically with the alias removed.

One thing worth flagging while on this file: `attached_assets/` is **not** listed in
`.dockerignore` (which does exclude `.canvas/`), so every `docker build` currently ships the
full 7.49 MB into the build context even though nothing in the image needs it. Independent of
the exposure question, this is worth a one-line fix if the assets stay.

---

## 3. `replit.md`

The backlog (`BACKLOG.md:92`) already logged four specific claims as wrong. All four verified
wrong again here, independently, against the current tree:

| Claim in `replit.md` | Actual, verified | Evidence |
|---|---|---|
| "Database: PostgreSQL + Drizzle ORM" | libSQL (SQLite-compatible) via `@libsql/client`. Drizzle ORM does exist, but only inside `lib/db`, a workspace package that nothing else imports (`grep -rln "@workspace/db"` returns only `replit.md` and the package's own `package.json`) | `artifacts/api-server/package.json:19` declares `@libsql/client`; `artifacts/api-server/src/lib/metricStore.ts` uses it directly |
| "Caching: 5-minute in-memory cache via `node-cache`" | No `node-cache` dependency anywhere in the repo. Caching is a custom libSQL-backed store (`metricStore.ts`) | `grep -rln "node-cache" --include=package.json .` returns nothing |
| "API routes: ... (10 route files ...)" | 27 route files | `find artifacts/api-server/src/routes -maxdepth 1 -name "*.ts" \| grep -v __tests__ \| wc -l` → 27 |
| "Validation: Zod (`zod/v4`)" | Zod v3. Workspace catalogue pins `^3.25.76`; `artifacts/api-server/package.json` resolves `zod: "catalog:"` against it | `grep -n "zod:" pnpm-workspace.yaml` → `zod: ^3.25.76` |

**Bonus finding, not one of the four flagged claims but adjacent:** `replit.md` says
"Node.js version: 24"; every `package.json` in the repo (root, api-server, m365-dashboard)
declares `"engines": {"node": ">=22"}`, and CI runs Node 22. Not one of the four claims this
brief asked me to check, so not scored above, but it's the same failure mode — the document
drifts and nobody notices because nothing enforces it against the code.

**Correct or delete?** Correct, not delete. There is no other architecture-orientation document
in the repository — no `CLAUDE.md`, no `ARCHITECTURE.md`, no `docs/architecture.md`. Every
agent (including the one writing this audit) currently has nothing else to read for a
one-paragraph orientation to the stack. Deleting it removes that entirely; correcting it fixes
the actual problem, which is staleness, not the wrong choice of document. Whether it should also
be renamed away from `replit.md` (given §5's finding that Replit-specific tooling is now mostly
inert) is a separate, larger decision — a name that says "read this to understand the codebase"
would serve better than one that implies Replit-only relevance, but that's a rename + content
rewrite, and this brief is report-only.

---

## 4. Missing governance files

Confirmed absent: `LICENSE` / `LICENSE.md`, `SECURITY.md`, `CONTRIBUTING.md`, `CODEOWNERS`
(checked at root and `.github/`). `package.json:4` declares `"license": "MIT"` with no `LICENSE`
file to back it — anyone redistributing the code has a claim with no accompanying grant text.

**Priority order, and why:**

1. **`SECURITY.md`.** This product authenticates to Microsoft Graph with an Azure AD
   application registration holding tenant-wide application permissions
   (`Directory.Read.All`, `SecurityEvents.Read.All`, and others listed in
   `lib/permissions-manifest/src/manifest.ts`). A vulnerability here doesn't just compromise
   this repository's own systems — it can expose whichever customer's tenant the running
   instance is pointed at. A public repo with that blast radius and no disclosed reporting
   channel means the first person to find a real vulnerability has to guess whether to email,
   open a public issue (which would itself be the disclosure), or say nothing. Highest
   priority by a wide margin.
2. **`LICENSE`.** Mechanical, five minutes, and closes the gap between what `package.json`
   claims and what's actually granted. Low effort, real (if modest) legal exposure while
   absent.
3. **`CODEOWNERS`.** Useful once there's more than one committer routing reviews; currently
   the repo's own git history shows a single author, so this mainly pre-positions for growth
   rather than closing an active gap.
4. **`CONTRIBUTING.md`.** Lowest urgency — no evidence of external contribution activity
   (no forks, no PR templates referenced, no issue templates) to make this the blocking gap.

### Draft `SECURITY.md` (proposal only — not committed)

```markdown
# Security Policy

## Scope

TenantDiscovery connects to Microsoft Graph using an Azure AD application registration with
application-level (client credential) permissions — see
`lib/permissions-manifest/src/manifest.ts` for the current list. Those permissions grant
tenant-wide read access to directory, security, compliance and device-management data. A
vulnerability in this codebase can expose another organisation's tenant data, not only this
project's own systems, so please treat reports accordingly.

## Reporting a vulnerability

Please do not open a public GitHub issue for a security vulnerability.

Report privately to: **[maintainer email — to be filled in before this file is committed]**.

Include, where you can:
- A description of the vulnerability and its impact
- Steps to reproduce, or a proof of concept
- The affected version, commit hash, or branch

We aim to acknowledge reports within 5 business days and to agree a disclosure timeline with
the reporter before any public write-up.

## Out of scope

- Reports that require the attacker to already hold valid Azure AD application credentials
  for the target tenant (credential handling itself is in scope; what a valid credential can
  see is expected behaviour of Graph API permissions)
- Denial of service against an instance the reporter deploys and controls themselves

## Supported versions

This project does not currently maintain multiple released versions. Security fixes are
applied to `main` only.
```

---

## 5. `.replit`, `.replitignore`, `@replit/vite-plugin-*`

- **`.replit`** (44 lines): configures Nix modules, deployment target, port mappings, and a
  `postMerge` hook (`scripts/post-merge.sh`) for Replit's own hosted run/deploy flow. None of
  this is read by `pnpm run build`, the test suite, or the Docker build (`docker-compose.yml`
  and the Dockerfiles under `artifacts/*/Dockerfile` define their own ports independently).
  Load-bearing only if the project is still actively run or deployed from within Replit's
  environment.
- **`.replitignore`** (5 lines): trims `.local` from Replit's own deploy-image sizing. Same
  status — inert outside Replit's publish flow.
- **`@replit/vite-plugin-cartographer`** and **`@replit/vite-plugin-dev-banner`**: both are
  dynamically imported only inside
  `...(process.env.NODE_ENV !== "production" && process.env.REPL_ID !== undefined ? [...] : [])`
  in both `artifacts/m365-dashboard/vite.config.ts` and `artifacts/mockup-sandbox/vite.config.ts`.
  Outside a Replit environment (`REPL_ID` unset), this branch never executes — the packages are
  present in `node_modules` and never loaded. Genuinely inert elsewhere.
- **`@replit/vite-plugin-runtime-error-modal`**: imported unconditionally at the top of both
  `vite.config.ts` files (`import runtimeErrorOverlay from "@replit/vite-plugin-runtime-error-modal"`)
  and instantiated unconditionally in the plugin list. This one **is** currently load-bearing —
  removing the dependency would break the Vite config's import statement in both dashboards,
  regardless of where they run. It behaves as a generic Vite dev-time error overlay; nothing in
  its usage here is Replit-specific beyond the package name.

If the project is confirmed no longer Replit-hosted, `.replit` and `.replitignore` can be
removed with no functional effect (nothing else reads them), and `cartographer` +
`dev-banner` can be removed along with their conditional blocks. `runtime-error-modal` needs
its `import` and plugin-list entry replaced with a non-Replit equivalent (or simply dropped) as
part of the same change, since it isn't gated the same way as its two siblings. All of that is
source and configuration file work, outside this brief's scope — noted here for whoever picks
it up.

---

## 6. Prepared remediation

Two options. Both are written out in full below so a human can copy the one they choose.
**Neither has been run.**

### Option A — remove from history entirely (irreversible, requires coordination)

```bash
# 1. Make sure nobody has uncommitted work anywhere that depends on current SHAs.
#    Every worktree/branch below is currently checked out against the pre-rewrite history:
#      main, agent/t01, agent/t02, agent/t03 (this one) — and likely agent/t04..t12 as the
#      wave-1/2/3 programme progresses. ALL of them need to be re-created or rebased after
#      this runs, or their merge-base with main silently breaks.

# 2. From a fresh clone (filter-repo insists on this, and it protects you from an
#    already-dirty working copy):
git clone https://github.com/TimHayward/TenantDiscovery.git TenantDiscovery-rewrite
cd TenantDiscovery-rewrite

# 3. Remove the two paths from every commit on every ref:
git filter-repo --path attached_assets --path .canvas --invert-paths

# 4. Force-push every branch and tag that existed before the rewrite:
git push origin --force --all
git push origin --force --tags

# 5. Every existing clone (yours, every agent worktree, anyone else's) is now diverged
#    from origin at the object level. They must re-clone, not `git pull` or `git fetch` +
#    reset — a pull will try to merge two unrelated histories. If any agent branch
#    (agent/t01..t12) has commits not yet merged to main, those commits must be
#    cherry-picked onto the new history by hand before their old branch is discarded.

# 6. Verify the removal actually worked, on the fresh clone:
git rev-list --objects --all | git cat-file --batch-check='%(objecttype) %(objectname) %(objectsize) %(rest)' \
  | awk '$1=="blob" && $4 ~ /^(attached_assets|\.canvas)\// {found=1; print} END{if(!found) print "clean: no matching blobs remain"}'
du -sh .git

# 7. GitHub itself caches old commits (PR diffs, cached forks, its own reflog) for a period
#    after a force-push. If the concern is a real tenant-data leak rather than tidiness,
#    contact GitHub Support to request a cache purge of the removed blobs — a force-push
#    alone does not guarantee the old objects are unreachable from GitHub's side immediately.
```

**What this breaks:** every commit hash after `0d17a09` (2026-05-02) changes. Every open PR
based on pre-rewrite `main` becomes unmergeable and needs to be recreated against the new
history. Every existing local clone or worktree needs to be discarded and re-cloned. Any
CI cache keyed by commit SHA is invalidated. Any external reference to a specific commit hash
(a changelog entry, an issue comment linking a commit, a deployed build tagged with a SHA) now
points at a hash that no longer exists on the rewritten branch.

**Who needs to re-clone:** every one of the four worktrees currently on disk
(`C:/GitHub/TenantDiscovery`, and `T01`/`T02`/`T03` under `C:/GitHub/td-agents`), plus anyone
else who has ever cloned the public repository — that population is not knowable or
controllable after the fact, which is the actual argument for treating this as irreversible:
you cannot un-expose a blob that a stranger already fetched before the rewrite ran.

### Option B — remove from the tip only, keep history intact (reversible, no coordination needed)

```bash
git rm -r attached_assets .canvas
git commit -m "Remove attached_assets and .canvas from the working tree"
git push origin main
```

**What this achieves:** the files disappear from every future clone's working directory and
from the GitHub file browser at the default branch. Ordinary `git clone` (without `--depth`)
still downloads them, because they remain in every commit before the removal — this does
**not** shrink `.git`, does not remove them from the pack, and does not stop someone running
`git log -- attached_assets` or checking out an old commit from seeing them. It is a visibility
change, not an exposure fix. If the answer to the §2 question turns out to be "yes, this is real
tenant data," Option B alone is not sufficient and Option A (or a targeted equivalent) is still
needed.

### My recommendation

**Do not run Option A yet.** Run Option B now for the pieces that are unambiguous regardless of
the exposure answer — the `Pasted-*.txt` files and the `.canvas` duplicate serve no purpose
under any answer, and removing them from the tip costs nothing and needs no coordination. Hold
the PDF, the spreadsheet, and the three full-resolution screenshots until a human who knows the
provenance of the "Example M365 Tenant Assessment Report" confirms whether it's synthetic. If
it's synthetic, Option B for everything is probably sufficient and Option A is unnecessary
churn for the whole team's git history. If it's real tenant data, Option A is warranted despite
the coordination cost, and it should be run once — with every currently-open agent branch
(t01–t12) accounted for beforehand — rather than as a rushed second pass.
