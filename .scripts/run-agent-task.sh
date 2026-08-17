#!/usr/bin/env bash
#
# run-agent-task.sh: run agent briefs from .claude/tasks/ headlessly against a
# Claude subscription, one at a time, each in its own git worktree.
#
# For Linux, macOS, or WSL2. On native Windows, use run-agent-task.ps1.
#
#   ./scripts/run-agent-task.sh T01
#   ./scripts/run-agent-task.sh T01 T02 T04 T03      # serial, in this order
#
# Serial by design. A subscription's usage limits will not sustain several
# concurrent long-running agents, and a headless run that hits a limit fails
# rather than waiting. Set AGENT_PARALLEL=1 to override, and expect to regret it.
#
# Environment:
#   AGENT_MODEL         default model alias, default "opus"
#   AGENT_MAX_TURNS     turn cap, default 300
#   AGENT_BASE          base branch, default "main"
#   AGENT_ROOT          worktree parent, default "../td-agents"
#   AGENT_PUSH          0 to keep branches local, default 1
#   AGENT_RETRY         retries after a usage limit, default 2
#   AGENT_RETRY_WAIT_M  minutes to wait before each retry, default 90
#   AGENT_PARALLEL      1 to run everything at once, default 0

set -uo pipefail

MODEL="${AGENT_MODEL:-opus}"
MAX_TURNS="${AGENT_MAX_TURNS:-300}"
BASE="${AGENT_BASE:-main}"
PUSH="${AGENT_PUSH:-1}"
RETRY="${AGENT_RETRY:-2}"
RETRY_WAIT_M="${AGENT_RETRY_WAIT_M:-90}"
PARALLEL="${AGENT_PARALLEL:-0}"

die() { printf 'error: %s\n' "$*" >&2; exit 1; }

# Mechanical tasks do not need Opus and burn capacity the others need.
model_for() {
  case "$1" in
    T01|T03|T05) echo "sonnet" ;;
    *)           echo "$MODEL" ;;
  esac
}

[ $# -ge 1 ] || die "usage: $0 <TASK> [TASK...]   e.g. $0 T01 T02 T04"

# An API key outranks subscription credentials and is used silently in -p mode.
if [ -n "${ANTHROPIC_API_KEY:-}" ]; then
  die "ANTHROPIC_API_KEY is set. It outranks your subscription and would be used
without prompting, billing API credit instead. Run: unset ANTHROPIC_API_KEY"
fi
[ -z "${ANTHROPIC_AUTH_TOKEN:-}" ] || die "ANTHROPIC_AUTH_TOKEN is set and outranks your subscription. Unset it."

command -v claude >/dev/null || die "claude not found. npm install -g @anthropic-ai/claude-code"
command -v git    >/dev/null || die "git not found"
command -v jq     >/dev/null || die "jq not found"

REPO_ROOT="$(git rev-parse --show-toplevel)" || die "not inside a git repository"
AGENT_ROOT="${AGENT_ROOT:-${REPO_ROOT}/../td-agents}"
LOG_DIR="${AGENT_ROOT}/logs"
CONTRACT="${REPO_ROOT}/.claude/tasks/CONTRACT.md"

[ -f "$CONTRACT" ] || die "CONTRACT.md not found at $CONTRACT"

# Validate every brief up front so a typo in the last task does not surface
# three hours in.
for task in "$@"; do
  [ -f "${REPO_ROOT}/.claude/tasks/${task}.md" ] || die "brief not found: ${task}.md"
done

mkdir -p "$LOG_DIR"

printf '\nRepository : %s\nWorktrees  : %s\nLogs       : %s\nTasks      : %s (%s)\n\n' \
  "$REPO_ROOT" "$AGENT_ROOT" "$LOG_DIR" "$*" \
  "$([ "$PARALLEL" = "1" ] && echo parallel || echo serial)"

run_task() {
  local task="$1"
  local brief="${REPO_ROOT}/.claude/tasks/${task}.md"
  local tree="${AGENT_ROOT}/${task}"
  local branch="agent/$(printf '%s' "$task" | tr '[:upper:]' '[:lower:]')"
  local log="${LOG_DIR}/${task}.log"
  local result="${LOG_DIR}/${task}.json"
  local prompt="${LOG_DIR}/${task}.prompt.txt"
  local task_model; task_model="$(model_for "$task")"

  if [ -e "$tree" ]; then
    printf '%s: SKIPPED, %s already exists. Remove it first.\n' "$task" "$tree" >&2
    return 1
  fi

  git -C "$REPO_ROOT" worktree add -b "$branch" "$tree" "$BASE" >>"$log" 2>&1 \
    || { printf '%s: worktree creation failed, see %s\n' "$task" "$log" >&2; return 1; }

  {
    echo "You are working on the TenantDiscovery repository, checked out at the"
    echo "current working directory. You have been dispatched to complete one task."
    echo
    echo "Work through the standing contract and the brief below in full. Both are"
    echo "authoritative. Where they conflict, the contract wins."
    echo
    echo "You are already on branch ${branch}. Make the changes, run the verification,"
    echo "write docs/agent-runs/${task}.md, and commit everything. Do not push."
    echo
    echo "===== STANDING CONTRACT ====="
    cat "$CONTRACT"
    echo
    echo "===== TASK BRIEF: ${task} ====="
    cat "$brief"
  } > "$prompt"

  # Keep the machine awake for the duration where the platform supports it.
  local wrapper=()
  command -v caffeinate >/dev/null && wrapper=(caffeinate -i)

  local attempt=0 status=1
  while :; do
    attempt=$((attempt+1))
    printf '%s: attempt %d, model %s, started %s\n' \
      "$task" "$attempt" "$task_model" "$(date +%H:%M:%S)"
    local start; start="$(date +%s)"

    # No --bare: bare mode does not read subscription credentials.
    # The prompt arrives on stdin to avoid argument length limits.
    ( cd "$tree" && "${wrapper[@]}" claude -p \
        --model "$task_model" \
        --max-turns "$MAX_TURNS" \
        --permission-mode acceptEdits \
        --allowedTools "Bash,Read,Edit,Write,Glob,Grep" \
        --output-format json \
        < "$prompt" \
    ) >"$result" 2>>"$log"
    status=$?

    local elapsed=$(( $(date +%s) - start ))
    local cost; cost="$(jq -r '.total_cost_usd // "unknown"' "$result" 2>/dev/null || echo unknown)"
    local text; text="$(jq -r '.result // ""' "$result" 2>/dev/null || cat "$result" 2>/dev/null)"

    printf '%s: exit %d after %dm%02ds, cost %s\n' \
      "$task" "$status" "$((elapsed/60))" "$((elapsed%60))" "$cost"

    if [ "$status" -eq 0 ] || [ "$attempt" -gt "$RETRY" ]; then break; fi
    if ! printf '%s' "$text" | grep -Eqi 'usage limit|rate.?limit|limit reached|too many requests|429'; then break; fi

    printf '%s: usage limit reached. Waiting %s minutes, then retrying.\n' "$task" "$RETRY_WAIT_M" >&2
    sleep $(( RETRY_WAIT_M * 60 ))
  done

  [ -z "$(git -C "$tree" status --porcelain)" ] \
    || printf '%s: WARNING uncommitted changes left in the worktree\n' "$task" >&2

  if [ -n "$(git -C "$tree" log --oneline "${BASE}..HEAD" 2>/dev/null)" ]; then
    if [ "$PUSH" = "1" ]; then
      git -C "$tree" push -u origin "$branch" >>"$log" 2>&1 \
        && printf '%s: pushed %s\n' "$task" "$branch" \
        || printf '%s: push failed, see %s\n' "$task" "$log" >&2
    fi
  else
    printf '%s: WARNING no commits produced\n' "$task" >&2
  fi

  [ -f "${tree}/docs/agent-runs/${task}.md" ] \
    && printf '%s: report at %s/docs/agent-runs/%s.md\n' "$task" "$tree" "$task" \
    || printf '%s: WARNING no report produced\n' "$task" >&2

  return "$status"
}

failures=0
if [ "$PARALLEL" = "1" ]; then
  pids=()
  for task in "$@"; do run_task "$task" & pids+=("$!"); sleep 5; done
  for pid in "${pids[@]}"; do wait "$pid" || failures=$((failures+1)); done
else
  for task in "$@"; do run_task "$task" || failures=$((failures+1)); printf '\n'; done
fi

printf -- '--- done: %d task(s), %d non-zero exit(s) ---\n' "$#" "$failures"
printf 'Review the branches, then clean up with:\n  git worktree remove %s/<TASK>\n' "$AGENT_ROOT"
exit "$failures"
