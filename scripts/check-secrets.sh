#!/usr/bin/env bash
# Fail the commit when obviously-secret-looking content is staged.
#
# This is a speed bump, not a secret scanner: it catches the common accidents
# (pasting a real key into .env, committing a rendered config). Real scanning
# belongs in CI or a dedicated tool.
set -euo pipefail

# Nothing staged means nothing to check.
staged=$(git diff --staged --name-only --diff-filter=ACMR)
if [ -z "$staged" ]; then
  exit 0
fi

# .env.example is documentation and is allowed to hold empty values.
check_list=$(printf '%s\n' "$staged" | grep -v -E '(^|/)\.env\.example$' || true)
if [ -z "$check_list" ]; then
  exit 0
fi

# Each pattern is a single line so grep -E can use them one at a time.
patterns=(
  'AIza[0-9A-Za-z_-]{35}'
  'sk-[A-Za-z0-9]{20,}'
  'ghp_[A-Za-z0-9]{36}'
  'github_pat_[A-Za-z0-9_]{60,}'
  'xox[baprs]-[A-Za-z0-9-]{10,}'
  'AKIA[0-9A-Z]{16}'
  '-----BEGIN [A-Z ]*PRIVATE KEY-----'
  'SERPAPI_API_KEY=[A-Za-z0-9]{16,}'
  'LLM_API_KEY=[A-Za-z0-9_-]{16,}'
)

fail=0

while IFS= read -r file; do
  [ -z "$file" ] && continue
  [ -f "$file" ] || continue

  content=$(git show ":$file" 2>/dev/null || true)
  [ -z "$content" ] && continue

  for pattern in "${patterns[@]}"; do
    if printf '%s' "$content" | grep -Eq -- "$pattern"; then
      echo "✗ $file matched a secret pattern: $pattern" >&2
      fail=1
    fi
  done
done <<< "$check_list"

if [ "$fail" -ne 0 ]; then
  echo "" >&2
  echo "Commit aborted. Unstage it with: git restore --staged <file>" >&2
  echo "Put real keys in .env (git-ignored). .env.example keeps values empty." >&2
  exit 1
fi

exit 0