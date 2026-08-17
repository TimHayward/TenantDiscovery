<#
.SYNOPSIS
    Run agent task briefs from .claude/tasks/ headlessly against a Claude
    subscription, one at a time, each in its own git worktree.

.DESCRIPTION
    Designed for an unattended Windows workstation reached over RDP. Runs tasks
    serially by default, because a subscription's usage limits will not sustain
    several concurrent long-running agents, and a headless run that hits a limit
    fails rather than waiting.

    Authenticates with your Claude subscription, not an API key. See
    RUNNING-ON-SUBSCRIPTION.md for the one-time login.

.PARAMETER Tasks
    One or more task identifiers, run in the order given.

.PARAMETER Model
    Model alias. Use 'opus' for judgement-heavy tasks and 'sonnet' for
    mechanical ones. Per-task overrides are in the ModelOverrides table below.

.PARAMETER MaxTurns
    Turn cap per task.

.PARAMETER Base
    Branch each worktree starts from.

.PARAMETER NoPush
    Keep branches local instead of pushing them.

.PARAMETER RetryOnLimit
    How many times to retry a task that failed on a usage limit.

.PARAMETER RetryWaitMinutes
    How long to wait before each retry.

.EXAMPLE
    .\run-agent-task.ps1 -Tasks T01

.EXAMPLE
    .\run-agent-task.ps1 -Tasks T01,T02,T04,T03
#>

[CmdletBinding()]
param(
    [Parameter(Mandatory = $true, Position = 0)]
    [string[]] $Tasks,

    [string] $Model = 'opus',
    [int]    $MaxTurns = 300,
    [string] $Base = 'main',
    [switch] $NoPush,
    [int]    $RetryOnLimit = 2,
    [int]    $RetryWaitMinutes = 90
)

$ErrorActionPreference = 'Stop'

# Mechanical tasks do not need Opus and burn subscription capacity that the
# judgement-heavy ones need. Override per task here.
$ModelOverrides = @{
    'T01' = 'sonnet'   # lint fixes, mechanical
    'T03' = 'sonnet'   # inventory and reporting
    'T05' = 'sonnet'   # dependency manifests
    # T02, T04, T06, T07, T08, T09, T10, T11, T12 stay on the -Model default
}

function Fail([string] $Message) {
    Write-Host "error: $Message" -ForegroundColor Red
    exit 1
}

function Require([string] $Command, [string] $Hint) {
    if (-not (Get-Command $Command -ErrorAction SilentlyContinue)) {
        Fail "$Command not found on PATH. $Hint"
    }
}

# --- preflight ---------------------------------------------------------------

Require 'git'    'Install Git for Windows. Claude Code also needs it for the Bash tool.'
Require 'node'   'Install Node.js 22 or later.'
Require 'claude' 'npm install -g @anthropic-ai/claude-code'

# An API key outranks subscription credentials and is used silently in -p mode.
# Refuse rather than bill the wrong account.
if ($env:ANTHROPIC_API_KEY) {
    Fail @'
ANTHROPIC_API_KEY is set in this environment. It takes precedence over your
subscription and would be used without prompting, billing API credit instead.

Clear it for this session:
    Remove-Item Env:ANTHROPIC_API_KEY

If it is set permanently, remove it from your user environment variables and
open a new terminal.
'@
}
if ($env:ANTHROPIC_AUTH_TOKEN) {
    Fail 'ANTHROPIC_AUTH_TOKEN is set and outranks your subscription. Clear it.'
}

$RepoRoot = (git rev-parse --show-toplevel 2>$null)
if (-not $RepoRoot) { Fail 'Not inside a git repository.' }
$RepoRoot = $RepoRoot -replace '/', '\'

$Contract = Join-Path $RepoRoot '.claude\tasks\CONTRACT.md'
if (-not (Test-Path $Contract)) { Fail "CONTRACT.md not found at $Contract" }

$AgentRoot = Join-Path (Split-Path $RepoRoot -Parent) 'td-agents'
$LogDir    = Join-Path $AgentRoot 'logs'
New-Item -ItemType Directory -Force -Path $LogDir | Out-Null

# Validate every brief before starting anything, so a typo in the last task
# does not surface three hours in.
foreach ($t in $Tasks) {
    $b = Join-Path $RepoRoot ".claude\tasks\$t.md"
    if (-not (Test-Path $b)) { Fail "Brief not found: $b" }
}

Write-Host ''
Write-Host "Repository : $RepoRoot"
Write-Host "Worktrees  : $AgentRoot"
Write-Host "Logs       : $LogDir"
Write-Host "Tasks      : $($Tasks -join ', ')  (serial)"
Write-Host ''

# --- one task ----------------------------------------------------------------

function Invoke-AgentTask {
    param([string] $Task)

    $brief    = Join-Path $RepoRoot ".claude\tasks\$Task.md"
    $tree     = Join-Path $AgentRoot $Task
    $branch   = "agent/$($Task.ToLower())"
    $log      = Join-Path $LogDir "$Task.log"
    $errLog   = Join-Path $LogDir "$Task.stderr.log"
    $resultF  = Join-Path $LogDir "$Task.json"
    $promptF  = Join-Path $LogDir "$Task.prompt.txt"
    $taskModel = if ($ModelOverrides.ContainsKey($Task)) { $ModelOverrides[$Task] } else { $Model }

    # A leftover worktree would silently resume half-finished work.
    if (Test-Path $tree) {
        Write-Host "$Task : SKIPPED, $tree already exists. Remove it first." -ForegroundColor Yellow
        return 1
    }

    git -C $RepoRoot worktree add -b $branch $tree $Base 2>&1 | Tee-Object -FilePath $log | Out-Null

    @(
        "You are working on the TenantDiscovery repository, checked out at the"
        "current working directory. You have been dispatched to complete one task."
        ""
        "Work through the standing contract and the brief below in full. Both are"
        "authoritative. Where they conflict, the contract wins."
        ""
        "You are already on branch $branch. Make the changes, run the verification,"
        "write docs/agent-runs/$Task.md, and commit everything. Do not push."
        ""
        "===== STANDING CONTRACT ====="
        (Get-Content $Contract -Raw)
        ""
        "===== TASK BRIEF: $Task ====="
        (Get-Content $brief -Raw)
    ) -join "`n" | Set-Content -Path $promptF -Encoding UTF8

    $attempt = 0
    $exit = 1

    while ($true) {
        $attempt++
        $started = Get-Date
        Write-Host ("{0} : attempt {1}, model {2}, started {3:HH:mm:ss}" -f $Task, $attempt, $taskModel, $started)

        Push-Location $tree
        try {
            # No --bare: bare mode does not read subscription credentials.
            # The prompt goes in on stdin to avoid command-line length limits.
            Get-Content $promptF -Raw | & claude -p `
                --model $taskModel `
                --max-turns $MaxTurns `
                --permission-mode acceptEdits `
                --allowedTools "Bash,Read,Edit,Write,Glob,Grep" `
                --output-format json `
                1> $resultF 2> $errLog
            $exit = $LASTEXITCODE
        }
        finally {
            Pop-Location
        }

        $elapsed = (Get-Date) - $started

        $cost = 'unknown'
        $resultText = ''
        try {
            $json = Get-Content $resultF -Raw | ConvertFrom-Json
            if ($null -ne $json.total_cost_usd) { $cost = $json.total_cost_usd }
            $resultText = "$($json.result)"
        } catch { $resultText = (Get-Content $resultF -Raw -ErrorAction SilentlyContinue) }

        Write-Host ("{0} : exit {1} after {2:hh\:mm\:ss}, cost {3}" -f $Task, $exit, $elapsed, $cost)

        $hitLimit = ($exit -ne 0) -and
                    ($resultText -match '(?i)(usage limit|rate.?limit|limit reached|too many requests|429)')

        if (-not $hitLimit -or $attempt -gt $RetryOnLimit) { break }

        Write-Host ("{0} : usage limit reached. Waiting {1} minutes, then retrying." -f $Task, $RetryWaitMinutes) -ForegroundColor Yellow
        Start-Sleep -Seconds ($RetryWaitMinutes * 60)
    }

    # --- post-run ---
    $dirty = git -C $tree status --porcelain
    if ($dirty) {
        Write-Host "$Task : WARNING uncommitted changes left in the worktree" -ForegroundColor Yellow
    }

    $commits = git -C $tree log --oneline "$Base..HEAD"
    if (-not $NoPush -and $commits) {
        git -C $tree push -u origin $branch 2>&1 | Tee-Object -FilePath $log -Append | Out-Null
        if ($LASTEXITCODE -eq 0) { Write-Host "$Task : pushed $branch" }
        else { Write-Host "$Task : push failed, see $log" -ForegroundColor Yellow }
    }
    elseif (-not $commits) {
        Write-Host "$Task : WARNING no commits produced" -ForegroundColor Yellow
    }

    $report = Join-Path $tree "docs\agent-runs\$Task.md"
    if (Test-Path $report) { Write-Host "$Task : report at $report" }
    else { Write-Host "$Task : WARNING no report produced" -ForegroundColor Yellow }

    return $exit
}

# --- serial dispatch ---------------------------------------------------------

$failures = 0
foreach ($t in $Tasks) {
    $code = Invoke-AgentTask -Task $t
    if ($code -ne 0) { $failures++ }
    Write-Host ''
}

Write-Host "--- done: $($Tasks.Count) task(s), $failures non-zero exit(s) ---"
Write-Host "Review the branches, then clean up with: git worktree remove $AgentRoot\<TASK>"
exit $failures
