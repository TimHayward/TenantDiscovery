# Standing contract for every agent task

Read this before the task brief. It applies to all of T01 to T12 without exception.

## Before you start

1. `pnpm install --frozen-lockfile`
2. `pnpm run typecheck && pnpm run test && pnpm run lint && pnpm run build`
3. Record the result. If the gate is already failing on arrival and your brief is not T01, note it in your report and work around it. Do not fix it. Do not let it justify skipping your own verification.
4. Create your branch: `git checkout -b agent/<TASK-ID>-<short-slug>`

## While you work

**Stay inside your scope.** Each brief lists the files you own. Editing a file outside that list is a defect, not initiative, because another agent is editing it right now. If your task genuinely cannot be completed without touching a file you do not own, stop, write the reason into your report, and deliver the part you can.

**Do not weaken a check to make it pass.** Specifically, do not add `eslint-disable` comments, do not add `@ts-expect-error`, do not relax an eslint rule severity, do not delete or skip a test, and do not narrow a test's assertions. If a rule is genuinely wrong for this codebase, say so in the report and leave the rule alone.

**Do not touch the security posture.** The loopback-by-default binding, the `ALLOW_REMOTE` gate, `assertSafeBinding`, helmet, the absence of default CORS, the parameterised SQL, the DNS-over-HTTPS-only resolver and `minimumReleaseAge: 1440` in `pnpm-workspace.yaml` are all deliberate. Changing any of them requires the change to be the stated objective of your brief.

**Never touch these.** `attached_assets/`, `.canvas/`, git history, `.env`, `onboarding-settings.json`, any `*.db` file. Never run `git push --force`, `git filter-repo`, `git rebase` on a shared branch, or `git commit --amend` on a pushed commit.

**Commit in readable increments.** One logical change per commit with a message that says what changed and why. Not one commit at the end.

## Before you finish

Run the full gate again and paste the real output into your report:

```
pnpm install --frozen-lockfile
pnpm run typecheck
pnpm run test
pnpm run lint
pnpm run build
```

All five must pass. If one does not, that is your result: report the failure honestly rather than reporting success.

## Do not stop early

Your brief has a "verification" section listing checks that go beyond the gate. Perform every one of them and show the evidence. A task that reaches the end of its edits in forty minutes has not finished; it has stopped editing. The verification is the other half of the work.

## The report

Write `docs/agent-runs/<TASK-ID>.md` with exactly these sections:

1. **Objective** — one paragraph, in your own words, of what you were asked to do.
2. **What changed** — a table of every file touched, with a one-line reason per file.
3. **Decisions and trade-offs** — every point where you chose between viable options, what you chose, and what you gave up. This is the section a reviewer reads first.
4. **What I did not do** — anything in scope that you left, and why. Be explicit. An honest gap is more useful than a quiet one.
5. **Verification** — the pasted output of the five gate commands, plus the evidence for each check in your brief's verification section.
6. **Risks and follow-ups** — anything you noticed that a human should look at, including things outside your scope.
7. **Cost and duration** — wall-clock time and, if available, token cost.

Then commit the report, push the branch, and open a **draft** pull request whose body is the contents of the report. Draft, not ready for review. A human decides when it is ready.

## Style

Follow the repository's existing conventions. Formal British English in prose and comments. No em dashes. No decorative language. If you add documentation, match the register of `README.md`.
