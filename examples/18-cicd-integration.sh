#!/bin/bash
# Example 18: CI/CD Integration
# Demonstrates using DeepL CLI in automated workflows

set -e  # Exit on error

echo "=== DeepL CLI Example 18: CI/CD Integration ==="
echo

# Check if API key is configured
if ! deepl auth show &>/dev/null; then
  echo "❌ Error: API key not configured"
  echo "Run: deepl auth set-key YOUR_API_KEY"
  exit 1
fi

echo "✓ API key configured"
echo

# Setup: Create temp directory for example scripts
TEMP_DIR="/tmp/deepl-example-18"
rm -rf "$TEMP_DIR"
mkdir -p "$TEMP_DIR"

# Example 1: Environment variable configuration
echo "1. Using environment variable for API key (CI/CD-friendly)"
echo "   Normally in CI/CD you'd set:"
echo "   export DEEPL_API_KEY=\${{ secrets.DEEPL_API_KEY }}"
echo
echo "   Current API key status:"
deepl auth show 2>&1 | head -2
echo

# Example 2: Automated documentation translation
echo "2. Automated documentation translation script"
echo
cat > "$TEMP_DIR/translate-docs.sh" << 'EOF'
#!/bin/bash
# translate-docs.sh - Translate all markdown documentation

set -e

DOCS_DIR="docs"
TARGET_LANGS="es,fr,de"
OUTPUT_DIR="docs/i18n"

mkdir -p "$OUTPUT_DIR"

echo "Translating documentation to: $TARGET_LANGS"

for doc in "$DOCS_DIR"/*.md; do
  if [ -f "$doc" ]; then
    filename=$(basename "$doc")
    echo "  Translating $filename..."
    deepl translate "$doc" --to "$TARGET_LANGS" --output "$OUTPUT_DIR/"
  fi
done

echo "✓ All documentation translated"
EOF

chmod +x "$TEMP_DIR/translate-docs.sh"
echo "   Created: $TEMP_DIR/translate-docs.sh"
echo

# Example 3: Git pre-commit hook for translation validation
echo "3. Git pre-commit hook example"
echo
cat > "$TEMP_DIR/pre-commit-hook.sh" << 'EOF'
#!/bin/bash
# .git/hooks/pre-commit - Validate translations before commit

set -e

echo "Checking for untranslated markdown files..."

# Get staged markdown files
STAGED_MD=$(git diff --cached --name-only --diff-filter=ACM | grep '\.md$' || true)

if [ -z "$STAGED_MD" ]; then
  echo "✓ No markdown files to translate"
  exit 0
fi

# Check if translations exist
MISSING_TRANSLATIONS=false

for file in $STAGED_MD; do
  # Skip files in i18n directories
  if [[ "$file" == *"/i18n/"* ]]; then
    continue
  fi

  # Check if Spanish translation exists
  es_file="${file%.md}.es.md"
  if [ ! -f "$es_file" ]; then
    echo "⚠ Warning: Missing Spanish translation for $file"
    MISSING_TRANSLATIONS=true
  fi
done

if [ "$MISSING_TRANSLATIONS" = true ]; then
  echo
  echo "Run: ./scripts/translate-docs.sh"
  exit 1
fi

echo "✓ All translations present"
exit 0
EOF

chmod +x "$TEMP_DIR/pre-commit-hook.sh"
echo "   Created: $TEMP_DIR/pre-commit-hook.sh"
echo

# Example 4: GitHub Actions workflow
echo "4. GitHub Actions workflow example"
echo
cat > "$TEMP_DIR/github-actions-workflow.yml" << 'EOF'
name: Translate Documentation

on:
  push:
    paths:
      - 'docs/**/*.md'
    branches:
      - main

jobs:
  translate:
    runs-on: ubuntu-latest

    steps:
      - uses: actions/checkout@v4

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '20'

      - name: Install DeepL CLI
        run: npm install -g @deepl/cli

      - name: Configure API Key
        env:
          DEEPL_API_KEY: ${{ secrets.DEEPL_API_KEY }}
        run: deepl auth set-key "$DEEPL_API_KEY"

      - name: Translate Documentation
        run: |
          mkdir -p docs/i18n

          for file in docs/*.md; do
            if [ -f "$file" ]; then
              echo "Translating $(basename $file)..."
              deepl translate "$file" --to es,fr,de --output docs/i18n/
            fi
          done

      - name: Commit Translations
        run: |
          git config user.name "Translation Bot"
          git config user.email "bot@example.com"
          git add docs/i18n/
          git diff --quiet && git diff --staged --quiet || \
            git commit -m "chore: update translations [skip ci]"
          git push
EOF

echo "   Created: $TEMP_DIR/github-actions-workflow.yml"
echo

# Example 5: Batch translation script with error handling
echo "5. Robust batch translation script"
echo
cat > "$TEMP_DIR/batch-translate.sh" << 'EOF'
#!/bin/bash
# batch-translate.sh - Translate files with error handling and logging

set -e

LOG_FILE="translation.log"
ERROR_LOG="translation-errors.log"
SOURCE_DIR="${1:-.}"
TARGET_LANGS="${2:-es,fr}"
OUTPUT_DIR="${3:-./translated}"

echo "=== Batch Translation ===" | tee "$LOG_FILE"
echo "Source: $SOURCE_DIR" | tee -a "$LOG_FILE"
echo "Targets: $TARGET_LANGS" | tee -a "$LOG_FILE"
echo "Output: $OUTPUT_DIR" | tee -a "$LOG_FILE"
echo | tee -a "$LOG_FILE"

mkdir -p "$OUTPUT_DIR"

SUCCESS=0
FAILED=0

for file in "$SOURCE_DIR"/*.{txt,md}; do
  if [ -f "$file" ]; then
    filename=$(basename "$file")
    echo "Translating $filename..." | tee -a "$LOG_FILE"

    if deepl translate "$file" --to "$TARGET_LANGS" --output "$OUTPUT_DIR/" 2>>"$ERROR_LOG"; then
      echo "  ✓ Success" | tee -a "$LOG_FILE"
      ((SUCCESS++))
    else
      echo "  ❌ Failed (see $ERROR_LOG)" | tee -a "$LOG_FILE"
      ((FAILED++))
    fi
  fi
done

echo | tee -a "$LOG_FILE"
echo "=== Summary ===" | tee -a "$LOG_FILE"
echo "Success: $SUCCESS" | tee -a "$LOG_FILE"
echo "Failed: $FAILED" | tee -a "$LOG_FILE"

if [ $FAILED -gt 0 ]; then
  echo "⚠ Some translations failed. Check $ERROR_LOG"
  exit 1
else
  echo "✓ All translations completed successfully"
  exit 0
fi
EOF

chmod +x "$TEMP_DIR/batch-translate.sh"
echo "   Created: $TEMP_DIR/batch-translate.sh"
echo

# Cleanup
echo "Cleaning up temporary files..."
rm -rf "$TEMP_DIR"
echo "✓ Cleanup complete"

echo "=== All CI/CD integration examples completed! ==="
echo
echo "📋 Example scripts demonstrated (created in /tmp, now cleaned up):"
echo "   - translate-docs.sh: Automated documentation translation"
echo "   - pre-commit-hook.sh: Git hook for translation validation"
echo "   - github-actions-workflow.yml: GitHub Actions workflow"
echo "   - batch-translate.sh: Robust batch translation with error handling"
echo
echo "💡 CI/CD tips:"
echo "   - Use DEEPL_API_KEY environment variable"
echo "   - Enable caching for faster CI runs"
echo "   - Use [skip ci] to avoid translation loops"
echo "   - Log errors for debugging"
