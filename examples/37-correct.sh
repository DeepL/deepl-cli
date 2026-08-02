#!/bin/bash
# Example 37: Correct — spelling and grammar correction without rewording
# Demonstrates the correct command: basic use, alias, check mode,
# fix with backup, diff view, and JSON output.

set -e

echo "=== DeepL CLI Example 37: Correct — Spelling and Grammar ==="
echo

if ! deepl auth show &>/dev/null; then
  echo "❌ Error: API key not configured"
  echo "Run: deepl auth set-key YOUR_API_KEY"
  exit 1
fi

echo "✓ API key configured"
echo

TEST_DIR="/tmp/deepl-correct-example-$$"
mkdir -p "$TEST_DIR"
trap 'rm -rf "$TEST_DIR"' EXIT

echo "1. Basic correction (language auto-detected)"
deepl correct "This is an test with some mistaks."
echo

echo "2. Explicit target language"
deepl correct "Their going too the store." --lang en-US
echo

echo "3. The c alias"
deepl c "I has a apple."
echo

echo "4. Diff view"
deepl correct "This are a example sentence." --lang en-US --diff
echo

echo "5. Check mode (exit 8 would mean corrections needed)"
echo "A sentence with an mistake." > "$TEST_DIR/draft.txt"
if deepl correct "$TEST_DIR/draft.txt" --check; then
  echo "No corrections needed"
else
  status=$?
  if [ "$status" -eq 8 ]; then
    echo "Corrections needed (exit code 8, as expected for this draft)"
  else
    exit "$status"
  fi
fi
echo

echo "6. Fix a file in place with a backup"
deepl correct "$TEST_DIR/draft.txt" --fix --backup
echo "Fixed content:"
cat "$TEST_DIR/draft.txt"
echo

echo "7. JSON output"
deepl correct "Their going too the store." --format json
echo

echo "=== Example complete ==="
