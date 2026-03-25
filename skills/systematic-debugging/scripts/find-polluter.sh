#!/usr/bin/env bash
# Find the first test file that creates unwanted filesystem state.
#
# Usage:
#   ./find-polluter.sh <pollution_path> <test_path_glob> '<run_template>'
#
# Notes:
# - <run_template> must include __TEST_FILE__ placeholder.
# - The test command's exit status is ignored; this script only checks pollution side effects.
#
# Examples:
#   ./find-polluter.sh '.git' 'src/**/*.test.ts' 'npm test __TEST_FILE__'
#   ./find-polluter.sh 'tmp/leak.txt' 'test/**/*_test.rb' 'bin/rails test __TEST_FILE__'

set -euo pipefail

usage() {
  cat <<'EOF'
Usage:
  find-polluter.sh <pollution_path> <test_path_glob> '<run_template>'

Arguments:
  pollution_path   File or directory that should NOT exist after each test.
  test_path_glob   Glob passed to find -path (example: 'test/**/*_test.rb').
  run_template     Command template with __TEST_FILE__ placeholder.

Example:
  find-polluter.sh '.git' 'src/**/*.test.ts' 'npm test __TEST_FILE__'
EOF
}

if [[ $# -ne 3 ]]; then
  usage
  exit 1
fi

POLLUTION_PATH="$1"
TEST_GLOB="$2"
RUN_TEMPLATE="$3"
LOG_FILE="${TMPDIR:-/tmp}/find-polluter-last.log"

if [[ "$RUN_TEMPLATE" != *"__TEST_FILE__"* ]]; then
  echo "ERROR: run_template must include __TEST_FILE__ placeholder" >&2
  exit 1
fi

# Expand ** by relying on find -path matching against full relative path.
mapfile -t TEST_FILES < <(find . -type f -path "$TEST_GLOB" | sort)

if (( ${#TEST_FILES[@]} == 0 )); then
  echo "No test files matched glob: $TEST_GLOB" >&2
  exit 1
fi

if [[ -e "$POLLUTION_PATH" ]]; then
  echo "ERROR: pollution target already exists: $POLLUTION_PATH" >&2
  echo "Clean it up first, then rerun." >&2
  exit 2
fi

echo "🔍 Searching for polluter"
echo "   Pollution target: $POLLUTION_PATH"
echo "   Test glob:        $TEST_GLOB"
echo "   Matched files:    ${#TEST_FILES[@]}"
echo

for i in "${!TEST_FILES[@]}"; do
  test_file="${TEST_FILES[$i]}"
  index=$((i + 1))

  if [[ -e "$POLLUTION_PATH" ]]; then
    echo "ERROR: pollution target appeared before running next test: $POLLUTION_PATH" >&2
    exit 2
  fi

  cmd="${RUN_TEMPLATE//__TEST_FILE__/$test_file}"

  echo "[$index/${#TEST_FILES[@]}] $test_file"
  bash -lc "$cmd" >"$LOG_FILE" 2>&1 || true

  if [[ -e "$POLLUTION_PATH" ]]; then
    echo
    echo "🎯 Found polluting test"
    echo "   Test:      $test_file"
    echo "   Pollution: $POLLUTION_PATH"
    echo "   Last log:  $LOG_FILE"
    echo
    echo "Re-run command:"
    echo "  $cmd"
    exit 1
  fi

done

echo

echo "✅ No polluting test found for $POLLUTION_PATH"
exit 0
