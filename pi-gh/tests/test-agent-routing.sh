#!/usr/bin/env bash
# =============================================================================
# test-agent-routing.sh — End-to-end agent-routing test for pi-gh
#
# Purpose:
#   Prove that Pi's agent actually invokes the pi-gh extension tools (gh_repo,
#   gh_issue, gh_pr, gh_actions) when given natural-language prompts, rather
#   than answering from general knowledge, using built-in tools, or silently
#   bypassing the extension.
#
# How it works:
#   1. Creates a fake `gh` binary that logs every call and returns canary JSON.
#   2. Launches Pi in non-interactive mode with ONLY the pi-gh extension loaded
#      and all built-in tools, other extensions, skills, and prompt templates
#      disabled.
#   3. Feeds prompts and checks Pi's output for the canary markers.
#   4. Also checks the fake-gh invocation log to confirm the right subcommands
#      were called.
#   5. Runs a negative test where gh auth fails, and asserts the extension
#      surfaces a structured error rather than hallucinating an answer.
#
# Requirements:
#   - `pi` on PATH (the Pi coding agent CLI)
#   - The pi-gh extension at ~/dev/pi-extensions/pi-gh/index.ts
#   - No network access needed (everything is faked)
#
# Usage:
#   cd ~/dev/pi-extensions/pi-gh
#   bash tests/test-agent-routing.sh
# =============================================================================
set -euo pipefail

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------

# Canary values — unique strings that cannot come from general knowledge.
# Avoid bracket-prefixed markers like [TAG-123] because the LLM strips them
# when summarizing tool output. Instead, embed canary IDs in natural text and
# in fields the agent reproduces verbatim (branch names, numeric IDs, URLs).
CANARY_REPO="canary-owner/CANARY-94731"
CANARY_ISSUE_TITLE="[TOOL-CANARY-55102] integration probe"
CANARY_PR_TITLE="refactor warp drive CANARY-PR-88214"
CANARY_RUN_TITLE="nightly build CANARY-RUN-67039"
CANARY_AUTH_ERROR="CANARY-AUTH-FAIL-30927: credential revoked"

# Extension entrypoint (resolved relative to this script's directory).
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
EXT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
EXT_ENTRY="$EXT_DIR/index.ts"

# ---------------------------------------------------------------------------
# Preflight: check for pi binary and extension entrypoint
# ---------------------------------------------------------------------------

if ! command -v pi &>/dev/null; then
  echo "FATAL: 'pi' binary not found on PATH."
  echo "Install it: npm i -g @mariozechner/pi-coding-agent"
  exit 1
fi

if [[ ! -f "$EXT_ENTRY" ]]; then
  echo "FATAL: Extension entrypoint not found: $EXT_ENTRY"
  exit 1
fi

echo "--- pi-gh agent-routing test ---"
echo "pi binary : $(command -v pi)"
echo "extension : $EXT_ENTRY"
echo ""

# ---------------------------------------------------------------------------
# Temp directory and cleanup trap
# ---------------------------------------------------------------------------

TMPDIR_BASE="$(mktemp -d)"
trap 'rm -rf "$TMPDIR_BASE"' EXIT

FAKE_GH_DIR="$TMPDIR_BASE/fake-gh-bin"
GH_LOG="$TMPDIR_BASE/gh-invocations.log"
OUTPUT_DIR="$TMPDIR_BASE/outputs"
mkdir -p "$FAKE_GH_DIR" "$OUTPUT_DIR"

# ---------------------------------------------------------------------------
# Create the fake `gh` binary
#
# This script intercepts all gh calls, logs them, and returns canary payloads
# depending on the subcommand. It uses simple argument matching — no real
# GitHub API calls are made.
# ---------------------------------------------------------------------------

cat > "$FAKE_GH_DIR/gh" <<'FAKEGH'
#!/usr/bin/env bash
# Fake gh binary for pi-gh routing tests.
# Logs every call and returns canary payloads.

CANARY_REPO="canary-owner/CANARY-94731"
CANARY_ISSUE_TITLE="[TOOL-CANARY-55102] integration probe"
CANARY_PR_TITLE="refactor warp drive CANARY-PR-88214"
CANARY_RUN_TITLE="nightly build CANARY-RUN-67039"

# Log the invocation (append).
echo "CALL: gh $*" >> "$GH_LOG_PATH"

# --- Route by arguments ---------------------------------------------------

# gh --version
if [[ "$1" == "--version" ]]; then
  echo "gh version 2.99.0-canary (fake)"
  exit 0
fi

# gh auth status
if [[ "$1" == "auth" && "$2" == "status" ]]; then
  # In negative-test mode, simulate auth failure.
  if [[ "${GH_FAKE_AUTH_FAIL:-0}" == "1" ]]; then
    echo "CANARY-AUTH-FAIL-30927: credential revoked" >&2
    exit 1
  fi
  echo "Logged in to github.com as canary-user (token)"
  exit 0
fi

# gh repo view --json nameWithOwner --jq .nameWithOwner
if [[ "$1" == "repo" && "$2" == "view" ]]; then
  # Check if this is the nameWithOwner-only preflight call
  if echo "$*" | grep -q "nameWithOwner.*--jq"; then
    echo "$CANARY_REPO"
    exit 0
  fi
  # Full repo view (gh_repo info)
  cat <<EOF
{
  "name": "CANARY-94731",
  "nameWithOwner": "$CANARY_REPO",
  "description": "Canary repo for routing tests",
  "url": "https://github.com/$CANARY_REPO",
  "defaultBranchRef": {"name": "main"},
  "isPrivate": false,
  "stargazerCount": 42,
  "forkCount": 7,
  "issues": {"totalCount": 5},
  "pullRequests": {"totalCount": 3}
}
EOF
  exit 0
fi

# gh issue list
if [[ "$1" == "issue" && "$2" == "list" ]]; then
  cat <<EOF
[
  {"number":101,"title":"$CANARY_ISSUE_TITLE","state":"OPEN","author":{"login":"canary-user"},"labels":[],"assignees":[],"createdAt":"2026-01-01T00:00:00Z","updatedAt":"2026-01-02T00:00:00Z"},
  {"number":102,"title":"Another canary issue","state":"OPEN","author":{"login":"canary-user"},"labels":[],"assignees":[],"createdAt":"2026-01-03T00:00:00Z","updatedAt":"2026-01-04T00:00:00Z"}
]
EOF
  exit 0
fi

# gh issue view <number>
if [[ "$1" == "issue" && "$2" == "view" ]]; then
  cat <<EOF
{
  "number": $3,
  "title": "$CANARY_ISSUE_TITLE",
  "state": "OPEN",
  "body": "This is canary issue body CANARY-94731",
  "author": {"login": "canary-user"},
  "labels": [],
  "assignees": [],
  "comments": [],
  "createdAt": "2026-01-01T00:00:00Z",
  "updatedAt": "2026-01-02T00:00:00Z",
  "closedAt": null
}
EOF
  exit 0
fi

# gh pr list
if [[ "$1" == "pr" && "$2" == "list" ]]; then
  cat <<EOF
[
  {"number":201,"title":"$CANARY_PR_TITLE","state":"OPEN","author":{"login":"canary-user"},"labels":[],"reviewRequests":[],"createdAt":"2026-02-01T00:00:00Z","updatedAt":"2026-02-02T00:00:00Z","headRefName":"feat/canary-pr-88214","baseRefName":"main","isDraft":false}
]
EOF
  exit 0
fi

# gh pr view <number>
if [[ "$1" == "pr" && "$2" == "view" ]]; then
  cat <<EOF
{
  "number": $3,
  "title": "$CANARY_PR_TITLE",
  "state": "OPEN",
  "body": "Canary PR body",
  "author": {"login": "canary-user"},
  "labels": [],
  "reviewRequests": [],
  "reviews": [],
  "comments": [],
  "commits": [],
  "files": [],
  "additions": 10,
  "deletions": 2,
  "createdAt": "2026-02-01T00:00:00Z",
  "updatedAt": "2026-02-02T00:00:00Z",
  "mergedAt": null,
  "closedAt": null,
  "headRefName": "feat/canary-pr-88214",
  "baseRefName": "main",
  "isDraft": false,
  "mergeable": "MERGEABLE"
}
EOF
  exit 0
fi

# gh workflow list
if [[ "$1" == "workflow" && "$2" == "list" ]]; then
  cat <<EOF
[
  {"id":1001,"name":"CI","state":"active","path":".github/workflows/ci.yml"}
]
EOF
  exit 0
fi

# gh run list
if [[ "$1" == "run" && "$2" == "list" ]]; then
  cat <<EOF
[
  {"databaseId":67039,"displayTitle":"$CANARY_RUN_TITLE","status":"completed","conclusion":"success","event":"push","headBranch":"main","createdAt":"2026-03-01T00:00:00Z","updatedAt":"2026-03-01T01:00:00Z","url":"https://github.com/$CANARY_REPO/actions/runs/67039"}
]
EOF
  exit 0
fi

# gh run view <id>
if [[ "$1" == "run" && "$2" == "view" ]]; then
  cat <<EOF
{
  "databaseId": 67039,
  "displayTitle": "$CANARY_RUN_TITLE",
  "status": "completed",
  "conclusion": "success",
  "event": "push",
  "headBranch": "main",
  "jobs": [],
  "createdAt": "2026-03-01T00:00:00Z",
  "updatedAt": "2026-03-01T01:00:00Z",
  "url": "https://github.com/$CANARY_REPO/actions/runs/67039"
}
EOF
  exit 0
fi

# Fallback: unknown command — log it and fail.
echo "fake-gh: unhandled command: gh $*" >&2
exit 1
FAKEGH

chmod +x "$FAKE_GH_DIR/gh"

# ---------------------------------------------------------------------------
# Test runner helpers
# ---------------------------------------------------------------------------

PASS_COUNT=0
FAIL_COUNT=0
RESULTS=()

# run_prompt <test_name> <prompt>
#
# Runs Pi with the given prompt in non-interactive mode, saves output.
# Exports the output path for assertion functions.
run_prompt() {
  local test_name="$1"
  local prompt="$2"
  local outfile="$OUTPUT_DIR/${test_name}.out"

  # Clear the gh invocation log before each test so assertions are scoped.
  : > "$GH_LOG"

  # Run Pi:
  #   -p             non-interactive (print and exit)
  #   -ne            disable extension auto-discovery
  #   -e <path>      load only our extension
  #   --no-tools     disable built-in tools (read, bash, edit, write)
  #   -ns            disable skills
  #   -np            disable prompt templates
  #   --no-themes    disable themes
  #   --no-session   don't persist session
  #
  # We prepend the fake gh dir to PATH so the extension's pi.exec("gh", ...)
  # calls find our fake binary first.
  GH_LOG_PATH="$GH_LOG" PATH="$FAKE_GH_DIR:$PATH" \
    pi -p \
      -ne \
      -e "$EXT_ENTRY" \
      --no-tools \
      -ns \
      -np \
      --no-themes \
      --no-session \
      "$prompt" \
    > "$outfile" 2>&1 || true

  CURRENT_OUT="$outfile"
  CURRENT_TEST="$test_name"
}

# assert_output_contains <marker> <description>
#
# Check that Pi's output contains the given marker string.
assert_output_contains() {
  local marker="$1"
  local desc="$2"
  if grep -qF "$marker" "$CURRENT_OUT"; then
    PASS_COUNT=$((PASS_COUNT + 1))
    RESULTS+=("PASS  $CURRENT_TEST: $desc")
  else
    FAIL_COUNT=$((FAIL_COUNT + 1))
    RESULTS+=("FAIL  $CURRENT_TEST: $desc (marker '$marker' not in output)")
  fi
}

# assert_output_not_contains <marker> <description>
#
# Check that Pi's output does NOT contain the given marker string.
assert_output_not_contains() {
  local marker="$1"
  local desc="$2"
  if ! grep -qF "$marker" "$CURRENT_OUT"; then
    PASS_COUNT=$((PASS_COUNT + 1))
    RESULTS+=("PASS  $CURRENT_TEST: $desc")
  else
    FAIL_COUNT=$((FAIL_COUNT + 1))
    RESULTS+=("FAIL  $CURRENT_TEST: $desc (marker '$marker' unexpectedly found in output)")
  fi
}

# assert_gh_called <subcommand_fragment> <description>
#
# Check that the fake gh log shows a call containing the given fragment.
assert_gh_called() {
  local fragment="$1"
  local desc="$2"
  if grep -qF "$fragment" "$GH_LOG"; then
    PASS_COUNT=$((PASS_COUNT + 1))
    RESULTS+=("PASS  $CURRENT_TEST: $desc")
  else
    FAIL_COUNT=$((FAIL_COUNT + 1))
    RESULTS+=("FAIL  $CURRENT_TEST: $desc (no gh call matching '$fragment' in log)")
  fi
}

# assert_gh_not_called <description>
#
# Check that no gh calls were made at all (e.g. for a bypass scenario).
assert_gh_not_called() {
  local desc="$1"
  if [[ ! -s "$GH_LOG" ]]; then
    PASS_COUNT=$((PASS_COUNT + 1))
    RESULTS+=("PASS  $CURRENT_TEST: $desc")
  else
    FAIL_COUNT=$((FAIL_COUNT + 1))
    RESULTS+=("FAIL  $CURRENT_TEST: $desc (expected no gh calls but log has: $(cat "$GH_LOG"))")
  fi
}

# ---------------------------------------------------------------------------
# Test Suite: Positive tests (extension should be used)
# ---------------------------------------------------------------------------

echo "=== Running positive routing tests ==="
echo ""

# --- Test 1: Repository info ---
# The agent should call gh_repo → triggers preflight (gh --version, gh auth
# status, gh repo view --jq) then gh repo view --json for full info.
# Pi's output must contain the canary repo name.

run_prompt "repo_info" "Show me info about this repository."
assert_gh_called "repo view" "fake gh was called with 'repo view'"
assert_output_contains "CANARY-94731" "output contains canary repo identifier"
assert_output_contains "canary-owner" "output contains canary owner"

# --- Test 2: List open issues ---
# The agent should call gh_issue with operation=list.

run_prompt "issue_list" "List the open issues."
assert_gh_called "issue list" "fake gh was called with 'issue list'"
assert_output_contains "TOOL-CANARY-55102" "output contains canary issue title marker"

# --- Test 3: Show issue 101 ---
# The agent should call gh_issue with operation=get, number=101.

run_prompt "issue_get" "Show issue 101."
assert_gh_called "issue view" "fake gh was called with 'issue view'"
assert_output_contains "TOOL-CANARY-55102" "output contains canary issue title"

# --- Test 4: List open PRs ---
# The agent should call gh_pr with operation=list.

run_prompt "pr_list" "List open pull requests."
assert_gh_called "pr list" "fake gh was called with 'pr list'"
assert_output_contains "88214" "output contains canary PR marker (ID or branch)"

# --- Test 5: List recent workflow runs ---
# The agent should call gh_actions with operation=list_runs.

run_prompt "actions_runs" "List recent workflow runs."
assert_gh_called "run list" "fake gh was called with 'run list'"
assert_output_contains "67039" "output contains canary run marker (ID or title)"

echo ""

# ---------------------------------------------------------------------------
# Test Suite: Negative test (auth failure)
#
# When gh auth status fails, the extension should return a structured error
# with code GH_NOT_AUTHENTICATED. The agent should surface this error rather
# than hallucinating an answer. Crucially, the canary repo data should NOT
# appear because the preflight should short-circuit before any data call.
# ---------------------------------------------------------------------------

echo "=== Running negative routing test (auth failure) ==="
echo ""

# Override the fake gh to simulate auth failure for this run.
ORIGINAL_FAKE_AUTH_FAIL="${GH_FAKE_AUTH_FAIL:-0}"

run_prompt_auth_fail() {
  local test_name="$1"
  local prompt="$2"
  local outfile="$OUTPUT_DIR/${test_name}.out"

  : > "$GH_LOG"

  GH_LOG_PATH="$GH_LOG" GH_FAKE_AUTH_FAIL=1 PATH="$FAKE_GH_DIR:$PATH" \
    pi -p \
      -ne \
      -e "$EXT_ENTRY" \
      --no-tools \
      -ns \
      -np \
      --no-themes \
      --no-session \
      "$prompt" \
    > "$outfile" 2>&1 || true

  CURRENT_OUT="$outfile"
  CURRENT_TEST="$test_name"
}

run_prompt_auth_fail "auth_fail" "List the open issues."

# The extension should surface the authentication error.
# It should NOT contain canary issue data (preflight blocked the call).
assert_output_contains "auth" "output mentions authentication problem"
assert_output_not_contains "TOOL-CANARY-55102" "canary issue data is NOT present (preflight blocked)"

echo ""

# ---------------------------------------------------------------------------
# Summary
# ---------------------------------------------------------------------------

echo "==========================================="
echo " RESULTS"
echo "==========================================="
for r in "${RESULTS[@]}"; do
  echo "  $r"
done
echo "-------------------------------------------"
echo "  Total: $((PASS_COUNT + FAIL_COUNT))  |  PASS: $PASS_COUNT  |  FAIL: $FAIL_COUNT"
echo "==========================================="
echo ""

if [[ $FAIL_COUNT -gt 0 ]]; then
  echo "Some tests failed. Inspect the output files in: $OUTPUT_DIR"
  echo "(They will be cleaned up on script exit. Copy them first if needed.)"
  echo ""

  # Dump the failed outputs for quick debugging.
  for r in "${RESULTS[@]}"; do
    if [[ "$r" == FAIL* ]]; then
      # Extract test name from "FAIL  <test_name>: ..."
      tname="$(echo "$r" | sed 's/^FAIL  \([^:]*\):.*/\1/')"
      ofile="$OUTPUT_DIR/${tname}.out"
      if [[ -f "$ofile" ]]; then
        echo "--- Output for $tname ---"
        head -60 "$ofile"
        echo "--- (end) ---"
        echo ""
      fi
    fi
  done

  # Exit non-zero so CI or the user sees a failure.
  exit 1
fi

echo "All tests passed."
echo ""

# ---------------------------------------------------------------------------
# Manual interactive test suggestion
#
# Destructive actions (close, merge, cancel) require confirmation gates.
# These cannot be tested in non-interactive mode because Pi's --print mode
# does not support interactive confirmation. The user should test these
# manually.
# ---------------------------------------------------------------------------

echo "--- Manual test for confirmation-gated actions ---"
echo ""
echo "To test that destructive actions (e.g., closing an issue) trigger"
echo "the extension's confirmation gate, run Pi interactively with the"
echo "fake gh on PATH:"
echo ""
echo "  GH_LOG_PATH=/tmp/gh-routing-test.log GH_FAKE_AUTH_FAIL=0 \\"
echo "    PATH=\"$FAKE_GH_DIR:\$PATH\" \\"
echo "    pi -ne -e $EXT_ENTRY --no-tools -ns -np --no-themes --no-session"
echo ""
echo "Then ask:"
echo "  > Close issue 101."
echo ""
echo "Expected: Pi should ask for confirmation before executing the close."
echo "If you decline, the tool should return USER_CANCELLED."
echo "Check /tmp/gh-routing-test.log to verify 'issue close' was NOT called."
echo ""
