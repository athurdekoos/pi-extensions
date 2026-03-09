#!/usr/bin/env bash
# =============================================================================
# run-all.sh — Run all pi-gh tests (unit + e2e) and print a combined summary.
#
# Test suites:
#   1. Unit tests      — vitest (tests/pi-gh.test.ts)
#   2. Agent routing   — bash   (tests/test-agent-routing.sh)
#
# Usage:
#   cd ~/dev/pi-extensions/pi-gh
#   bash tests/run-all.sh
#
# Exit code: 0 if all suites pass, 1 if any suite fails.
# =============================================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

cd "$PROJECT_DIR"

SUITE_RESULTS=()
OVERALL_EXIT=0

# ---------------------------------------------------------------------------
# Helper: run a suite, capture exit code, record result.
# ---------------------------------------------------------------------------
run_suite() {
  local name="$1"
  shift
  local exit_code=0

  echo ""
  echo "==========================================="
  echo " SUITE: $name"
  echo "==========================================="
  echo ""

  "$@" || exit_code=$?

  if [[ $exit_code -eq 0 ]]; then
    SUITE_RESULTS+=("PASS  $name")
  else
    SUITE_RESULTS+=("FAIL  $name (exit $exit_code)")
    OVERALL_EXIT=1
  fi
}

# ---------------------------------------------------------------------------
# Suite 1: Unit tests (vitest)
# ---------------------------------------------------------------------------
run_suite "unit tests (vitest)" npx vitest run

# ---------------------------------------------------------------------------
# Suite 2: Agent-routing e2e test
# ---------------------------------------------------------------------------
run_suite "agent routing (e2e)" bash tests/test-agent-routing.sh

# ---------------------------------------------------------------------------
# Suite 3: Agent-routing e2e test (variant 2)
# ---------------------------------------------------------------------------
run_suite "agent routing v2 (e2e)" bash tests/test-agent-routing2.sh

# ---------------------------------------------------------------------------
# Combined summary
# ---------------------------------------------------------------------------
echo ""
echo "==========================================="
echo " ALL SUITES"
echo "==========================================="
for r in "${SUITE_RESULTS[@]}"; do
  echo "  $r"
done
echo "-------------------------------------------"
if [[ $OVERALL_EXIT -eq 0 ]]; then
  echo "  All suites passed."
else
  echo "  Some suites failed."
fi
echo "==========================================="

exit $OVERALL_EXIT
