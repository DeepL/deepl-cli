#!/bin/bash
# Example 31: Sync — CI/CD Integration
# Demonstrates using deepl sync in automated pipelines

set -e  # Exit on error

echo "=== DeepL CLI Example 31: Sync — CI/CD Integration ==="
echo

# Check if API key is configured
if ! deepl auth show &>/dev/null; then
  echo "Error: API key not configured"
  echo "Run: deepl auth set-key YOUR_API_KEY"
  exit 1
fi

echo "API key configured"
echo

# Setup: Create a test project
PROJECT_DIR="/tmp/deepl-sync-ci-demo"
rm -rf "$PROJECT_DIR"
mkdir -p "$PROJECT_DIR/locales"

cleanup() {
  rm -rf "$PROJECT_DIR"
}
trap cleanup EXIT

echo "Created test project: $PROJECT_DIR"
echo

# Create source and target files
cat > "$PROJECT_DIR/locales/en.json" << 'EOF'
{
  "greeting": "Hello!",
  "farewell": "Goodbye!"
}
EOF

cd "$PROJECT_DIR"

deepl sync init \
  --source-locale en \
  --target-locales de,fr \
  --file-format json \
  --path "locales/en.json"

# Run initial sync so we have translations
deepl sync
echo

# Example 1: Frozen mode (CI check)
echo "1. Frozen mode — verify translations are up to date"
echo "   This makes no API calls, just checks the lockfile."
echo

if deepl sync --frozen; then
  echo "   Exit code 0: translations are up to date"
else
  echo "   Exit code 10: translations are out of date (drift detected)"
fi
echo

# Example 2: Simulate drift
echo "2. Simulate translation drift"
echo "   Adding a new key without syncing..."

cat > "$PROJECT_DIR/locales/en.json" << 'EOF'
{
  "greeting": "Hello!",
  "farewell": "Goodbye!",
  "new_key": "This string has not been translated yet."
}
EOF

echo "   Running --frozen to detect drift..."
echo

if deepl sync --frozen; then
  echo "   Exit code 0: no drift (unexpected)"
else
  EXIT_CODE=$?
  echo "   Exit code $EXIT_CODE: drift detected (expected in CI)"
  echo "   A CI pipeline would fail at this point."
fi
echo

# Example 3: Fix drift by syncing
echo "3. Fix drift by running sync"
deepl sync
echo

echo "   Verifying with --frozen..."
if deepl sync --frozen; then
  echo "   Exit code 0: translations are now up to date"
fi
echo

# Example 4: JSON output for CI parsing
echo "4. JSON output for CI/CD scripting"
echo "   Use --format json for machine-readable output."
echo

deepl sync status --format json
echo

# Example 5: GitHub Actions workflow
echo "5. Example GitHub Actions workflow:"
echo
cat << 'WORKFLOW'
   name: i18n Sync Check
   on: [pull_request]

   jobs:
     check-translations:
       runs-on: ubuntu-latest
       steps:
         - uses: actions/checkout@v4
         - run: npm install -g @deepl/cli
         - name: Check translations are up to date
           run: deepl sync --frozen
           env:
             DEEPL_API_KEY: ${{ secrets.DEEPL_API_KEY }}
WORKFLOW
echo

# Example 6: GitLab CI configuration
echo "6. Example GitLab CI configuration:"
echo
cat << 'GITLAB'
   i18n-check:
     stage: test
     image: node:20
     script:
       - npm install -g @deepl/cli
       - deepl sync --frozen
     variables:
       DEEPL_API_KEY: $DEEPL_API_KEY
     rules:
       - if: $CI_PIPELINE_SOURCE == "merge_request_event"
GITLAB
echo

# Example 7: Auto-sync on main branch
echo "7. Example auto-sync workflow (push to main):"
echo
cat << 'AUTOSYNC'
   name: i18n Auto-Sync
   on:
     push:
       branches: [main]
       paths:
         - "locales/en/**"

   jobs:
     sync-translations:
       runs-on: ubuntu-latest
       steps:
         - uses: actions/checkout@v4
         - run: npm install -g @deepl/cli
         - name: Sync translations
           run: deepl sync --format json
           env:
             DEEPL_API_KEY: ${{ secrets.DEEPL_API_KEY }}
         - name: Commit updated translations
           run: |
             git config user.name "github-actions[bot]"
             git config user.email "github-actions[bot]@users.noreply.github.com"
             git add locales/
             git diff --cached --quiet || git commit -m "chore(i18n): sync translations"
             git push
AUTOSYNC
echo

# Example 8: Exit code handling in scripts
echo "8. Exit code handling for CI scripts:"
echo
cat << 'EXITCODES'
   #!/bin/bash
   deepl sync --frozen
   EXIT_CODE=$?

   case $EXIT_CODE in
     0)  echo "Translations up to date" ;;
     6)  echo "Invalid input" ;;
     7)  echo "Config error — check .deepl-sync.yaml" ;;
     10) echo "Translation drift — run 'deepl sync' locally" ;;
     *)  echo "Unexpected error: $EXIT_CODE" ;;
   esac
EXITCODES
echo

echo "=== CI/CD Integration Summary ==="
echo
echo "Recommended workflow:"
echo "  1. Developers run 'deepl sync' locally after changing source strings"
echo "  2. Commit .deepl-sync.lock and translated files"
echo "  3. CI runs 'deepl sync --frozen' to verify translations are current"
echo "  4. Optionally, a post-merge job runs 'deepl sync' to auto-translate"
echo
echo "Key flags for CI/CD:"
echo "  --frozen       Fail if translations are out of date (no API calls)"
echo "  --format json  Machine-readable output for parsing"
echo "  --dry-run      Preview without translating (cost estimation)"
echo

echo "=== All examples completed successfully! ==="
