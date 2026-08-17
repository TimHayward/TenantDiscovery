# TenantDiscovery: unattended agent work plan

Prepared 3 August 2026 against `main` at commit `2240042` ("Interface consistency alignment").

Everything below was verified by cloning the repository, installing with the committed lockfile, and running `typecheck`, `test`, `lint` and `build` on Node 22.22.2 with pnpm 10.33.0. Where this plan disagrees with `BACKLOG.md`, the plan reflects the working tree as it stands today.

---

## 1. State of the repository

### 1.1 The build on `main` is red

The most recent CI run on `main` (17 July 2026) failed. The cause is the lint step, not the code:

| Step | Result |
| --- | --- |
| `pnpm install --frozen-lockfile` | passes, 17.7s |
| `pnpm run typecheck` | passes, all four projects clean |
| `pnpm run test` | passes, 19 files, 101 tests |
| `pnpm run lint` | **fails**, 11 errors and 33 warnings |
| `pnpm run build` | passes, 11.4s |

The eleven errors are trivial:

| File | Error |
| --- | --- |
| `artifacts/api-server/build.mjs:126,127` | `no-undef` on `console` and `process` (the build script is not covered by a Node env block in the flat config) |
| `artifacts/api-server/src/lib/collectors/adminExposure.ts:301` | `prefer-const` on `displayName` |
| `artifacts/api-server/src/lib/collectors/adoption.ts:22` | `no-irregular-whitespace` |
| `artifacts/api-server/src/lib/collectors/exchange.ts:30,31` | `prefer-const` on `sharedMailboxes`, `roomMailboxes` |
| `artifacts/api-server/src/routes/m365Adoption.ts:19` | `no-irregular-whitespace` |
| `artifacts/m365-dashboard/src/components/CollapsibleSection.tsx:28,38,70` | `no-empty` |
| `artifacts/m365-dashboard/src/pages/tabs/SecurityTab.tsx:486` | `no-empty` |

This matters more than the individual errors do. Every agent brief in this plan ends with "the full gate passes". If the gate is already failing on arrival, each agent has to decide whether the pre-existing failure is its problem, and they will each decide differently. Fixing this is therefore a prerequisite, not a task in its own right, and it is folded into T01.

### 1.2 The backlog is materially stale in places

`BACKLOG.md` item 5.2 claims 155 occurrences of `any` across eighteen files in the collector and route layers. The current count is seven across the whole of `api-server/src`, and zero in `collectors` and `routes`. That work has effectively been done. The residual `any` is now in the dashboard, principally four occurrences in `SecurityTab.tsx`.

Item 6.7 is likewise closer to done than the backlog records, but the remaining half is real and is measurable now (see 1.4).

Two backlog items I could not confirm as done and which remain genuinely open: no `engines` field exists anywhere in the workspace; `.gitignore` still has no `*.db` entry, so a `METRIC_DB_PATH` pointed inside the tree is committable.

### 1.3 `mockup-sandbox` is 6,343 lines of parallel universe

`artifacts/mockup-sandbox` is a second Vite application carrying its own copy of the shadcn component set. Of the components present in both applications, 36 files are byte-identical to their `m365-dashboard` counterparts and 19 have diverged. It is in the pnpm workspace, so CI typechecks and builds it on every push, and its dependency ranges are already ahead of the dashboard's (Radix 1.2.12 against 1.2.4, for instance).

The divergence is the problem rather than the duplication. Two copies of `sidebar.tsx` that differ by an unknown amount, one of which nobody looks at, is a slow-acting source of "why does it look different in the mockup" confusion.

### 1.4 The chart vendor chunk defeats the lazy tab split

The production build produces per-tab chunks correctly, but `vite.config.ts` forces every Recharts module into a single `charts` vendor chunk:

```
charts-CQ7SM5zD.js      420.77 kB │ gzip: 113.54 kB
index-B6fsyx89.js       298.01 kB │ gzip:  92.28 kB
manifest-Dhz5m8Yw.js    117.81 kB │ gzip:  17.66 kB
radix-BUOWyOXV.js       114.53 kB │ gzip:  36.73 kB
tables-CiUG7nTV.js       97.64 kB │ gzip:  27.56 kB
```

The largest single artefact in the build is a charting library that the Overview tab needs and the Settings tab does not. The `manualChunks` rule that creates it is three lines long. This is the concrete remainder of backlog 6.7.

### 1.5 Test coverage is one-sided

101 tests, all in `api-server` and `permissions-manifest`, all pure-logic. Nothing exercises an HTTP route, despite `supertest` sitting in `devDependencies` unused since it was added. Nothing exercises the SQLite stores against a real (in-memory) libSQL client. The dashboard, at 19,822 lines, has no test infrastructure of any kind.

`findingsRules.test.ts` still skips the security, compliance and licensing rule groups.

### 1.6 Repository weight, and a question I am not going to answer on your behalf

`attached_assets/` is 7.2 MB of committed material, of which 5.65 MB is a single file named `Example_M365_Tenant_Assessment_Report_15.12.2025_*.pdf`, accompanied by a 396 KB `.xlsx` of the same name and three screenshots. `.canvas/` adds a further 436 KB.

The repository is public.

I have not opened those files and I am not proposing that an agent does anything about them. Whether an example tenant assessment report is safe to hold in a public repository is a judgement about the underlying data and about whoever it was produced for, and it is yours to make. T03 is scoped to report and to prepare the remediation, and explicitly forbidden from executing it.

### 1.7 Governance files are absent

No `LICENSE` (though `package.json` declares MIT), no `SECURITY.md`, no `CONTRIBUTING.md`, no `CODEOWNERS`, no Dependabot configuration. For a public repository that reads Microsoft Graph with application credentials, the missing `SECURITY.md` is the one that would actually be noticed.

### 1.8 What is genuinely good

Worth saying plainly, because it shapes what the agents should not touch. The security posture of the running service is well thought through: loopback binding by default with an explicit `ALLOW_REMOTE` opt-in and a pure, unit-tested `assertSafeBinding`; helmet; no CORS unless configured; parameterised SQL with an `assertSafeBinding` equivalent for bindings; DNS over HTTPS only; escaped HTML in exports; in-memory export generation. The `minimumReleaseAge: 1440` supply-chain guard in `pnpm-workspace.yaml` is a control most teams do not think to apply. The generated Zod and React Query layers give the whole thing a typed spine.

None of the briefs below relax any of that, and each says so.

---

## 2. Task inventory

Twelve activities. Each is scoped to occupy a capable agent for at least two hours of genuine work, and each owns a disjoint set of files within its wave so that parallel runs do not collide.

| ID | Title | Kind | Wave | Est. |
| --- | --- | --- | --- | --- |
| T01 | Restore a green gate and make it strict | cleanup | 1 | 2 to 3h |
| T02 | Route and store test coverage | cleanup | 1 | 4h |
| T03 | Repository weight and data-exposure audit (report only) | cleanup | 1 | 2h |
| T04 | Secrets at rest and optional API authentication | feature | 1 | 3 to 4h |
| T05 | Dependency and workspace hygiene | cleanup | 2 | 2 to 3h |
| T06 | Bundle budget and request-path efficiency | enhancement | 2 | 3h |
| T07 | Shared UI kit and sandbox quarantine | cleanup | 2 | 3h |
| T08 | Per-host concurrency limiting for collection | enhancement | 2 | 3h |
| T09 | Per-tab URL routing and deep links | enhancement | 3 | 3h |
| T10 | Offline demonstration mode with fixture tenants | **new** | 3 | 4h |
| T11 | Scan history and drift timeline | enhancement | 3 | 4h |
| T12 | Dashboard test harness | cleanup | 3 | 3h |

Full briefs are in `.claude/tasks/`.

### Why the waves

Wave 1 tasks touch disjoint trees: T01 owns the lint surface and CI, T02 owns `__tests__`, T03 owns `docs/` only, T04 owns the settings and store modules. They can all run at once.

Wave 2 depends on T01 having landed, because T05 edits the root `package.json` that T01 also edits, and because T06 and T07 both need a green gate to measure against.

Wave 3 is sequenced last because T09, T11 and T12 all touch `Dashboard.tsx` or its tab registry. T09 must land before T11. T10 produces the fixtures that make T12 tractable, so T12 runs last of all.

If you only get one wave away today, run wave 1. If you want the single highest-value item in isolation, it is T02.

### On the two-hour requirement

There is no flag that makes an agent run for two hours. Duration is a consequence of scope. Each brief is sized so that the definition of done cannot honestly be reached in less, and each carries a "do not stop early" clause listing the verification the agent must perform before it reports. An agent that finishes in forty minutes has almost certainly skipped the verification rather than worked quickly, and the report format is designed to make that visible.

---

## 3. Risks I want on the record

**The gate is the only thing standing between you and a bad merge.** You will be reviewing this on a phone, days later, against work you did not watch. Do not merge anything where the PR body does not show the five commands passing with their actual output. T01 exists to make that signal trustworthy.

**Parallel agents on one repository will conflict unless you isolate them.** Use one git worktree per task, or one runner per task in Actions. Sharing a working directory between two headless runs produces interleaved edits that look like a merge conflict but are not one.

**`--dangerously-skip-permissions` on your Mac Studio is not the same risk as in a container.** Your local checkout may hold a real `onboarding-settings.json` with Azure client credentials, because it is gitignored rather than absent. An agent with unrestricted bash on that machine can read it. Prefer `--permission-mode acceptEdits` with a scoped `--allowedTools`, or run in Actions where the checkout is clean.

**Cost is unbounded unless you bound it.** Twelve long-running agents is a meaningful spend. `--max-turns` and `--output-format json` (which reports `total_cost_usd`) are the controls. The runner script sets both.

**An agent asked to make lint pass will sometimes make lint pass the wrong way.** Deleting a test, widening an eslint disable, or loosening a rule all satisfy "the gate is green". Every brief forbids this explicitly, and T01 in particular. Read the diffs for `eslint-disable` and for deleted test cases first.

**Nothing in this plan starts by itself.** I cannot launch a background job from this conversation. You have to run one of the two methods in section 4 before you leave.

---

## 4. How to run this

### Option A: GitHub Actions, dispatched from your phone (recommended while away)

`.github/workflows/agent-task.yml` adds a `workflow_dispatch` job that takes a task ID, installs the Claude Code CLI on the runner, runs the brief headlessly, and opens a draft pull request with the post-implementation report as the PR body.

This is the right choice for today because you can dispatch it from the GitHub mobile app, the checkout is clean so there are no local credentials to expose, each task gets its own runner and therefore its own working directory, and the output arrives as a reviewable PR rather than as commits on your machine.

Set-up, once, before you go:

1. Create an API key at https://platform.claude.com and add it as the repository secret `ANTHROPIC_API_KEY`.
2. In Settings, Actions, General, set Workflow permissions to "Read and write" and tick "Allow GitHub Actions to create and approve pull requests".
3. Commit `.github/workflows/agent-task.yml` and `.claude/tasks/` to `main`.
4. From the Actions tab, run "Agent task" and pick `T01`. Confirm it opens a PR before dispatching the rest.

Then dispatch T02, T03 and T04. When wave 1 has merged, dispatch wave 2, and so on.

The job sets `timeout-minutes: 360`. The GitHub-hosted runner limit for a single job is six hours, which is the real ceiling on any one task.

I have deliberately not used `anthropics/claude-code-action@v1` here. The action's own documentation still lists `workflow_dispatch` as pending, and I would rather you find out today than after a failed dispatch. Installing the CLI and calling `claude -p` directly works regardless of which events the action supports, and it is the same runtime underneath. If you would rather use the action, swap the two steps for `uses: anthropics/claude-code-action@v1` with `prompt_file` and `claude_args`, and test it once before relying on it.

### Option B: Claude Code headless on the Mac Studio

`scripts/run-agent-task.sh` creates a git worktree per task under `../td-agents/`, runs `claude -p` inside it with a turn cap and scoped permissions, captures the JSON envelope including cost, and pushes a branch.

```bash
# one task
./scripts/run-agent-task.sh T01

# a whole wave, in parallel, each in its own worktree
./scripts/run-agent-task.sh T01 T02 T03 T04
```

Leave the machine awake (`caffeinate -i` is wrapped into the script) and the runs continue without you. Output lands in `../td-agents/<task>/` and logs in `logs/`.

This gives you more control and no per-minute runner limit, but it needs the machine on, and it puts agents on a filesystem that may hold live tenant credentials. If you use it, run `ls ~/.tenant-discovery` or wherever `ONBOARDING_SETTINGS_DIR` points first, and move anything real out of reach.

### Option C: the VS Code extension

Not suitable for this. The extension is an interactive surface: it will reach a decision point and wait for you, and you will not be there. Use it on Monday to review the diffs, which is what it is good at.

### Option D: Claude on the web

Also not suitable for multi-hour autonomous work. A web conversation runs only while a turn is in flight. It is the right tool for reviewing a PR body on your phone and asking follow-up questions, not for producing the PR.

---

## 5. Files delivered

```
AGENT-PLAN.md                       this document
.claude/tasks/T01..T12.md           one brief per activity
.github/workflows/agent-task.yml    dispatchable Actions runner
scripts/run-agent-task.sh           local worktree runner
```

Drop them into the repository root and commit. Nothing else in the repository is modified.
