# Running the agent programme on your Claude subscription

Supersedes section 4 of `AGENT-PLAN.md`. Use this instead of the GitHub Actions route if you want the work billed to your Claude subscription rather than to API credit.

---

## What changes, and why

Three things differ from the API-key plan, and all three are consequences of the subscription rather than preferences.

**Bare mode is out.** The scripts no longer pass `--bare`. Anthropic's documentation states plainly that bare mode does not read `CLAUDE_CODE_OAUTH_TOKEN` and that a script using it must authenticate with an API key or an `apiKeyHelper` instead. The version I gave you earlier used `--bare` for CI determinism, which was correct for a runner and wrong here. Without it, Claude Code reads any `.claude/settings.json`, hooks and skills present in the working directory, which is a minor loss of reproducibility and the price of subscription authentication.

**An API key silently wins if one is present.** Credential precedence puts `ANTHROPIC_API_KEY` above both the OAuth token and the subscription login, and in `-p` mode it is used whenever present, with no prompt. On a shared workstation that variable may already be set by something else. Both scripts refuse to start if they find it.

**Serial, not parallel.** The original plan ran wave 1 as four concurrent agents. That was sized for API billing, where concurrency costs money but nothing else. On a subscription it costs your usage allowance, and a headless run that hits a limit does not wait, it fails and the work in flight is lost. The scripts now run tasks one at a time by default, and retry after a wait if they detect a limit.

The practical consequence: plan on three or four tasks in a day, not twelve. Mechanical tasks are pinned to Sonnet in both scripts to stretch what you have. `T01`, `T03` and `T05` run on Sonnet; the rest use whatever you pass as the default.

Revised order for a serial run: **T01, T02, T04, T03**. T03 produces no code, so it is the one to drop if you run short.

---

## Part 1: prepare the workstation

Do this over RDP while you are still at a keyboard. It needs a browser on the workstation, or at least the ability to paste a URL into a browser somewhere.

### 1.1 Install the prerequisites

Open PowerShell as your normal user, not as administrator.

```powershell
node --version    # need 22 or later
git --version     # Git for Windows; Claude Code needs it for the Bash tool
```

If either is missing:

```powershell
winget install OpenJS.NodeJS.LTS
winget install Git.Git
```

Close and reopen PowerShell so the new PATH takes effect, then:

```powershell
npm install -g pnpm@10.33.0
npm install -g @anthropic-ai/claude-code
claude --version
```

### 1.2 Make sure no API key is lurking

```powershell
$env:ANTHROPIC_API_KEY
$env:ANTHROPIC_AUTH_TOKEN
[Environment]::GetEnvironmentVariable('ANTHROPIC_API_KEY','User')
[Environment]::GetEnvironmentVariable('ANTHROPIC_API_KEY','Machine')
```

All four should return nothing. If any returns a value, remove it before continuing. The scripts will stop you anyway, but it is easier to find now than at three in the morning.

### 1.3 Log in with your subscription

```powershell
claude
```

On first launch it opens a browser. Sign in with the Claude.ai account that holds your subscription. If the browser shows a login code rather than redirecting back, paste that code into the terminal at the prompt. That happens routinely over RDP, because the browser cannot always reach Claude Code's local callback server.

Once you see `Login successful`, press Enter, then type `/status` and confirm the login row shows your subscription account. Then `/exit`.

### 1.4 Generate a long-lived token

The `/login` credential expires and warns you three days out, which is no use if you are away for a fortnight. `claude setup-token` mints a one-year OAuth token against the same subscription.

```powershell
claude setup-token
```

Approve in the browser. The token prints to the terminal once and is not saved anywhere, so copy it immediately. Then set it for your user:

```powershell
[Environment]::SetEnvironmentVariable('CLAUDE_CODE_OAUTH_TOKEN','sk-ant-oat01-...','User')
```

Close and reopen PowerShell. Verify:

```powershell
$env:CLAUDE_CODE_OAUTH_TOKEN.Substring(0,20)
```

Treat that token as a credential of the same weight as a password. It authorises model requests against your subscription for a year. If the workstation is shared, this step is the one to think twice about.

### 1.5 Stop the machine going to sleep

```powershell
powercfg /change standby-timeout-ac 0
powercfg /change hibernate-timeout-ac 0
powercfg /change monitor-timeout-ac 15
```

The monitor may sleep. The machine must not.

### 1.6 Check that a disconnected session survives

This is the step people skip and then lose eight hours of work to. Many managed builds apply a policy that signs out disconnected RDP sessions after a set idle period.

```powershell
Get-ItemProperty 'HKLM:\SOFTWARE\Policies\Microsoft\Windows NT\Terminal Services' -ErrorAction SilentlyContinue |
  Select-Object MaxDisconnectionTime, MaxIdleTime
```

If `MaxDisconnectionTime` comes back with a value, your session will be terminated after that many milliseconds and everything running in it dies with it. If it is set and you cannot change it, use the scheduled-task approach in Part 4 instead.

---

## Part 2: get the repository and the briefs onto the workstation

```powershell
cd $HOME
git clone https://github.com/TimHayward/TenantDiscovery.git
cd TenantDiscovery
```

You need to authenticate to GitHub so the agents can push their branches. The simplest route is the GitHub CLI:

```powershell
winget install GitHub.cli
gh auth login          # HTTPS, authenticate via browser
gh auth setup-git
```

Then place the files. If you have already committed them to `main` from the browser session, `git pull` is enough. If not, copy them in and commit:

```
.claude\tasks\CONTRACT.md
.claude\tasks\T01.md  ... T12.md
scripts\run-agent-task.ps1
AGENT-PLAN.md
RUNNING-ON-SUBSCRIPTION.md
```

```powershell
git add .claude scripts AGENT-PLAN.md RUNNING-ON-SUBSCRIPTION.md
git commit -m "Add agent task briefs and subscription runner"
git push
```

The `.github/workflows/agent-task.yml` file from the earlier version is not used by this route. Leave it out unless you also want the Actions option, in which case it needs its own API key and will bill separately.

Confirm the repository builds on this machine before you hand it to an agent. If `pnpm install` fails here, every agent will fail the same way and you will not find out for hours:

```powershell
pnpm install --frozen-lockfile
pnpm run typecheck
pnpm run test
```

Typecheck and test should pass. Lint will fail with eleven errors; that is expected and is what T01 fixes.

---

## Part 3: run it

### 3.1 A single task first

```powershell
cd $HOME\TenantDiscovery
.\scripts\run-agent-task.ps1 -Tasks T01
```

Watch the first two minutes. You should see the worktree created at `..\td-agents\T01`, then the agent begin working. If it exits within seconds, read `..\td-agents\logs\T01.stderr.log`.

T01 runs on Sonnet and should take roughly an hour. Do not queue anything else until it has produced a branch and a report.

### 3.2 The rest, queued

```powershell
.\scripts\run-agent-task.ps1 -Tasks T01,T02,T04,T03
```

They run in sequence. Each gets its own worktree under `..\td-agents\` and its own branch, pushed on completion so you can review from anywhere.

If a task fails because you have hit a usage limit, the script waits ninety minutes and retries, up to twice. Adjust with `-RetryWaitMinutes` and `-RetryOnLimit`. If you are on Pro rather than Max, raise the wait: the retry is only useful if the window has actually reset.

### 3.3 Then disconnect, do not sign out

Close the RDP window with the **X**, or use **Start, your user, Disconnect**.

Do **not** use **Sign out**. Signing out terminates the session and every process in it, including the agent, mid-edit.

---

## Part 4: if disconnected sessions get killed on your build

If step 1.6 showed a `MaxDisconnectionTime` policy you cannot change, run the queue as a scheduled task instead, which survives independently of any interactive session.

```powershell
$action  = New-ScheduledTaskAction `
  -Execute 'powershell.exe' `
  -Argument '-NoProfile -ExecutionPolicy Bypass -File "C:\Users\<you>\TenantDiscovery\scripts\run-agent-task.ps1" -Tasks T01,T02,T04,T03' `
  -WorkingDirectory 'C:\Users\<you>\TenantDiscovery'

$trigger = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(2)

Register-ScheduledTask -TaskName 'TenantDiscoveryAgents' `
  -Action $action -Trigger $trigger `
  -RunLevel Limited -User $env:USERNAME
```

Register it with **Run whether user is logged on or not** left off and the user logged on, or the task will run in a context that cannot read your Claude credentials, which live under `%USERPROFILE%\.claude`. If you must run it logged off, the `CLAUDE_CODE_OAUTH_TOKEN` from step 1.4 is what makes that work, because it is an environment variable rather than a stored login.

You will not see console output. Everything is in `..\td-agents\logs\`.

---

## Part 5: checking in from your phone

Every completed task pushes a branch named `agent/t01`, `agent/t02` and so on, and writes its report to `docs/agent-runs/<TASK>.md` inside that branch. On the GitHub mobile app or in a browser, open the branch and read the report.

The two things worth checking in each report, in this order:

1. **Verification.** Does it contain real pasted command output, or a claim that the commands passed? If it is a claim, treat the whole run as unverified.
2. **Decisions and trade-offs.** This is where an agent tells you what it was unsure about. An empty or perfunctory section on a task like T04 or T10 means it did not think hard enough.

Then look at the diff for two specific things the contract forbids: newly added `eslint-disable` or `@ts-expect-error`, and deleted or skipped tests. Both are what "make the gate green" looks like when an agent takes the easy route.

Do not merge anything from the phone. Merge when you are back at a machine and can run the gate yourself.

---

## What to do when it goes wrong

| Symptom | Cause and fix |
| --- | --- |
| Script stops immediately citing `ANTHROPIC_API_KEY` | Exactly as designed. Clear the variable, including from user and machine scope, and open a new terminal. |
| `Login expired` in the log | The `/login` credential lapsed. This is why step 1.4 exists. Set `CLAUDE_CODE_OAUTH_TOKEN` and rerun. |
| Task exits in seconds, `stderr.log` mentions authentication | Either no login on this machine, or a `--bare` flag has crept back in. Bare mode cannot see subscription credentials. |
| Every task fails on a usage limit | You are out of allowance for the window. Nothing to fix; wait for the reset, and consider dropping the default model to Sonnet with `-Model sonnet`. |
| `worktree add` fails, path exists | A previous run left it behind. `git worktree remove ..\td-agents\T0x` then retry. The script refuses rather than resuming half-finished work. |
| Agent produced commits but no report | It ran out of turns before writing up. Raise `-MaxTurns`, and read the diff manually. |
| Nothing at all happened overnight | The session was signed out, or the machine slept. Check steps 1.5 and 1.6. |
