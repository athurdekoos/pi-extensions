#!/usr/bin/env bash
set -euo pipefail

# Pi extension routing probe for pi-gh.
#
# What it tests:
#   1) Whether pi actually routes GitHub prompts into the pi-gh extension.
#   2) Whether the extension then executes gh through pi.exec("gh", ...).
#   3) Whether setup/preflight failures surface through the extension's error contract.
#
# Usage:
#   chmod +x ./test-agent-routing.sh
#   ./test-agent-routing.sh
#
# Environment overrides:
#   PI_BIN=pi
#   EXTENSION_PATH=../index.ts
#   WORK_REPO=/path/to/repo                  # default: temp repo created by script
#   KEEP_TMP=1                              # keep temp directory
#   PI_EXTRA_ARGS='--provider ... --model ...'
#   PROMPT_TIMEOUT=180
#
# Notes:
#   - This uses pi print mode (-p) so it can run unattended.
#   - It isolates resources with --no-tools --no-skills --no-prompt-templates
#     --no-themes --no-extensions, then loads only your extension via -e.
#   - High-impact confirmation flows are best verified manually in interactive mode.

PI_BIN="${PI_BIN:-pi}"
SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
EXTENSION_PATH="${EXTENSION_PATH:-$SCRIPT_DIR/../index.ts}"
PROMPT_TIMEOUT="${PROMPT_TIMEOUT:-180}"
PI_EXTRA_ARGS="${PI_EXTRA_ARGS:-}"
KEEP_TMP="${KEEP_TMP:-0}"

if ! command -v "$PI_BIN" >/dev/null 2>&1; then
  echo "ERROR: pi binary not found: $PI_BIN" >&2
  exit 1
fi

if [[ ! -f "$EXTENSION_PATH" ]]; then
  echo "ERROR: extension not found: $EXTENSION_PATH" >&2
  exit 1
fi

TMP_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/pi-gh-routing.XXXXXX")"
FAKE_BIN_DIR="$TMP_ROOT/bin"
LOG_DIR="$TMP_ROOT/logs"
mkdir -p "$FAKE_BIN_DIR" "$LOG_DIR"

cleanup() {
  if [[ "$KEEP_TMP" == "1" ]]; then
    echo "Keeping temp dir: $TMP_ROOT"
  else
    rm -rf "$TMP_ROOT"
  fi
}
trap cleanup EXIT

if [[ -n "${WORK_REPO:-}" ]]; then
  REPO_DIR="$WORK_REPO"
else
  REPO_DIR="$TMP_ROOT/repo"
  mkdir -p "$REPO_DIR"
  git -C "$REPO_DIR" init -q
  git -C "$REPO_DIR" config user.name "pi-gh probe"
  git -C "$REPO_DIR" config user.email "probe@example.invalid"
  touch "$REPO_DIR/README.md"
  git -C "$REPO_DIR" add README.md
  git -C "$REPO_DIR" commit -qm "init"
  git -C "$REPO_DIR" branch -M main >/dev/null 2>&1 || true
  git -C "$REPO_DIR" remote add origin "https://github.com/canary-owner/canary-repo.git"
fi

cat >"$FAKE_BIN_DIR/gh" <<'GH_EOF'
#!/usr/bin/env bash
set -euo pipefail

LOG_FILE="${PI_GH_PROBE_LOG:?PI_GH_PROBE_LOG is required}"
MODE="${PI_GH_PROBE_MODE:-success}"
printf '%s\tgh\t%s\n' "$(date -Is)" "$*" >> "$LOG_FILE"

fail() {
  local code="$1"
  shift
  printf '%s\n' "$*" >&2
  exit "$code"
}

case "$MODE" in
  notinstalled)
    if [[ "${1:-}" == "--version" ]]; then
      fail 127 'gh: command not found'
    fi
    ;;
  unauthenticated)
    if [[ "${1:-}" == "auth" && "${2:-}" == "status" ]]; then
      fail 1 'You are not logged into any GitHub hosts. Run: gh auth login'
    fi
    ;;
  unavailable)
    if [[ "${1:-}" == "repo" && "${2:-}" == "view" ]]; then
      fail 1 'fatal: not a git repository or no GitHub remote found'
    fi
    ;;
  success) ;;
  *) fail 64 "Unknown PI_GH_PROBE_MODE=$MODE" ;;
esac

if [[ "${1:-}" == "--version" ]]; then
  echo 'gh version 99.99.99-probe'
  exit 0
fi

if [[ "${1:-}" == "auth" && "${2:-}" == "status" ]]; then
  echo 'github.com'
  echo '  ✓ Logged in to github.com as probe-user' >&2
  exit 0
fi

# Common repo resolution and repo info paths.
if [[ "${1:-}" == "repo" && "${2:-}" == "view" ]]; then
  if [[ "$*" == *'--jq .nameWithOwner'* ]]; then
    echo 'canary-owner/CANARY-94731'
    exit 0
  fi

  cat <<'JSON'
{
  "name": "CANARY-94731",
  "nameWithOwner": "canary-owner/CANARY-94731",
  "description": "probe response from fake gh",
  "url": "https://example.invalid/canary",
  "defaultBranchRef": { "name": "main" },
  "isPrivate": false,
  "stargazerCount": 4242,
  "forkCount": 17,
  "issues": { "totalCount": 3 },
  "pullRequests": { "totalCount": 2 }
}
JSON
  exit 0
fi

if [[ "${1:-}" == "issue" && "${2:-}" == "list" ]]; then
  cat <<'JSON'
[
  {
    "number": 101,
    "title": "[TOOL-CANARY-ISSUE-55102] integration probe",
    "state": "OPEN",
    "url": "https://example.invalid/issues/101"
  }
]
JSON
  exit 0
fi

if [[ "${1:-}" == "issue" && ( "${2:-}" == "view" || "${2:-}" == "get" ) ]]; then
  cat <<'JSON'
{
  "number": 101,
  "title": "[TOOL-CANARY-ISSUE-55102] integration probe",
  "state": "OPEN",
  "body": "Detailed canary payload from fake gh issue view",
  "url": "https://example.invalid/issues/101"
}
JSON
  exit 0
fi

if [[ "${1:-}" == "pr" && "${2:-}" == "list" ]]; then
  cat <<'JSON'
[
  {
    "number": 202,
    "title": "[TOOL-CANARY-PR-66301] routing probe",
    "state": "OPEN",
    "url": "https://example.invalid/pull/202"
  }
]
JSON
  exit 0
fi

if [[ "${1:-}" == "pr" && ( "${2:-}" == "view" || "${2:-}" == "get" ) ]]; then
  cat <<'JSON'
{
  "number": 202,
  "title": "[TOOL-CANARY-PR-66301] routing probe",
  "state": "OPEN",
  "body": "Detailed canary payload from fake gh pr view",
  "url": "https://example.invalid/pull/202"
}
JSON
  exit 0
fi

if [[ "${1:-}" == "workflow" && "${2:-}" == "list" ]]; then
  cat <<'JSON'
[
  {
    "name": "[TOOL-CANARY-WF-77119] CI",
    "path": ".github/workflows/ci.yml",
    "state": "active"
  }
]
JSON
  exit 0
fi

if [[ "${1:-}" == "run" && "${2:-}" == "list" ]]; then
  cat <<'JSON'
[
  {
    "databaseId": 303,
    "displayTitle": "[TOOL-CANARY-RUN-88442] recent workflow run",
    "status": "completed",
    "conclusion": "success",
    "workflowName": "CI",
    "url": "https://example.invalid/actions/runs/303"
  }
]
JSON
  exit 0
fi

if [[ "${1:-}" == "run" && ( "${2:-}" == "view" || "${2:-}" == "get" ) ]]; then
  cat <<'JSON'
{
  "databaseId": 303,
  "displayTitle": "[TOOL-CANARY-RUN-88442] recent workflow run",
  "status": "completed",
  "conclusion": "success",
  "workflowName": "CI",
  "url": "https://example.invalid/actions/runs/303"
}
JSON
  exit 0
fi

fail 42 "UNHANDLED_PROBE_CASE: $*"
GH_EOF
chmod +x "$FAKE_BIN_DIR/gh"

BASE_ARGS=(
  -p
  --no-session
  --no-tools
  --no-skills
  --no-prompt-templates
  --no-themes
  --no-extensions
  -e "$EXTENSION_PATH"
)

if [[ -n "$PI_EXTRA_ARGS" ]]; then
  # shellcheck disable=SC2206
  EXTRA_ARGS=($PI_EXTRA_ARGS)
else
  EXTRA_ARGS=()
fi

run_pi_prompt() {
  local mode="$1"
  local label="$2"
  local prompt="$3"
  local out_file="$LOG_DIR/${label}.out.txt"
  local err_file="$LOG_DIR/${label}.err.txt"
  local gh_log="$LOG_DIR/${label}.gh.log"

  : >"$gh_log"
  echo "==> $label"
  echo "    prompt: $prompt"

  set +e
  (
    cd "$REPO_DIR"
    export PATH="$FAKE_BIN_DIR:$PATH"
    export PI_GH_PROBE_LOG="$gh_log"
    export PI_GH_PROBE_MODE="$mode"
    timeout "$PROMPT_TIMEOUT" \
      "$PI_BIN" "${BASE_ARGS[@]}" "${EXTRA_ARGS[@]}" "$prompt"
  ) >"$out_file" 2>"$err_file"
  local rc=$?
  set -e

  echo "    rc=$rc"
  echo "    out=$out_file"
  echo "    err=$err_file"
  echo "    ghlog=$gh_log"

  RUN_RC="$rc"
  RUN_OUT="$out_file"
  RUN_ERR="$err_file"
  RUN_GHLOG="$gh_log"
}

pass_count=0
fail_count=0

assert_contains() {
  local file="$1"
  local needle="$2"
  local desc="$3"
  if grep -Fq "$needle" "$file"; then
    echo "    PASS: $desc"
    pass_count=$((pass_count + 1))
  else
    echo "    FAIL: $desc"
    echo "      missing: $needle"
    echo "      in file: $file"
    fail_count=$((fail_count + 1))
  fi
}

assert_not_empty() {
  local file="$1"
  local desc="$2"
  if [[ -s "$file" ]]; then
    echo "    PASS: $desc"
    pass_count=$((pass_count + 1))
  else
    echo "    FAIL: $desc"
    echo "      file empty: $file"
    fail_count=$((fail_count + 1))
  fi
}

assert_any_contains() {
  local desc="$1"
  local needle="$2"
  shift 2
  local found=0
  local file
  for file in "$@"; do
    if grep -Fq "$needle" "$file"; then
      found=1
      break
    fi
  done
  if [[ "$found" == "1" ]]; then
    echo "    PASS: $desc"
    pass_count=$((pass_count + 1))
  else
    echo "    FAIL: $desc"
    echo "      missing: $needle"
    echo "      checked: $*"
    fail_count=$((fail_count + 1))
  fi
}

# Positive probe: repo info should show the canary, and fake gh should be invoked.
run_pi_prompt success repo_info 'Show me info about this repository.'
assert_not_empty "$RUN_GHLOG" 'gh wrapper was invoked for repo_info'
assert_contains "$RUN_GHLOG" 'repo view' 'repo_info called gh repo view'
assert_any_contains 'repo_info surfaced repo canary in pi output' 'canary-owner/CANARY-94731' "$RUN_OUT" "$RUN_ERR"

# Positive probe: issue list should flow through issue tooling.
run_pi_prompt success issue_list 'List the open issues.'
assert_not_empty "$RUN_GHLOG" 'gh wrapper was invoked for issue_list'
assert_contains "$RUN_GHLOG" 'issue list' 'issue_list called gh issue list'
assert_any_contains 'issue_list surfaced issue canary in pi output' '[TOOL-CANARY-ISSUE-55102]' "$RUN_OUT" "$RUN_ERR"

# Positive probe: PR list should flow through PR tooling.
run_pi_prompt success pr_list 'List open PRs.'
assert_not_empty "$RUN_GHLOG" 'gh wrapper was invoked for pr_list'
assert_contains "$RUN_GHLOG" 'pr list' 'pr_list called gh pr list'
assert_any_contains 'pr_list surfaced PR canary in pi output' '[TOOL-CANARY-PR-66301]' "$RUN_OUT" "$RUN_ERR"

# Positive probe: workflow runs should flow through actions tooling.
run_pi_prompt success runs_list 'List recent workflow runs.'
assert_not_empty "$RUN_GHLOG" 'gh wrapper was invoked for runs_list'
assert_contains "$RUN_GHLOG" 'run list' 'runs_list called gh run list'
assert_any_contains 'runs_list surfaced workflow canary in pi output' '[TOOL-CANARY-RUN-88442]' "$RUN_OUT" "$RUN_ERR"

# Negative probe: preflight auth failure should surface the extension error contract.
run_pi_prompt unauthenticated auth_fail 'Show me info about this repository.'
assert_not_empty "$RUN_GHLOG" 'gh wrapper was invoked for auth_fail'
assert_contains "$RUN_GHLOG" 'auth status' 'auth_fail called gh auth status'
assert_any_contains 'auth_fail surfaced auth error' 'auth' "$RUN_OUT" "$RUN_ERR"

# Negative probe: gh missing should surface the install error contract.
run_pi_prompt notinstalled missing_gh 'Show me info about this repository.'
assert_not_empty "$RUN_GHLOG" 'gh wrapper was invoked for missing_gh'
assert_contains "$RUN_GHLOG" '--version' 'missing_gh called gh --version'
assert_any_contains 'missing_gh surfaced install error' 'cli.github.com' "$RUN_OUT" "$RUN_ERR"

echo
echo '==== Summary ===='
echo "pass=$pass_count"
echo "fail=$fail_count"
echo "tmp=$TMP_ROOT"
echo

if ((fail_count > 0)); then
  echo 'Interpretation:'
  echo '  - If gh logs are empty but pi still answered, the agent likely bypassed the extension.'
  echo '  - If gh logs exist but canaries never appear, routing or result rendering is suspect.'
  echo '  - If GH_NOT_* errors never surface on negative probes, preflight may be bypassed.'
  exit 1
fi

echo 'All routing probes passed.'
echo 'Manual follow-up for confirmation-gated mutations:'
echo "  cd '$REPO_DIR'"
echo "  PATH='$FAKE_BIN_DIR':\$PATH PI_GH_PROBE_MODE=success PI_GH_PROBE_LOG='$LOG_DIR/manual.gh.log' $PI_BIN --no-tools --no-skills --no-prompt-templates --no-themes --no-extensions -e '$EXTENSION_PATH'"
echo '  Then ask: Close issue #101.'
echo '  Expected: pi should request confirmation before invoking the mutation path.'
