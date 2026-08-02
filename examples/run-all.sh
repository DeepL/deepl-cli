#!/bin/bash
# Run All Examples - Validation Script
# Runs all DeepL CLI example scripts for testing and validation

set +e  # Don't exit on error, we want to run all examples

echo "=== Running All DeepL CLI Examples ==="
echo "This will run all example scripts and report results."
echo "⚠️  Warning: This will make real API calls and consume quota."
echo

# Check API key first
if ! deepl auth show &>/dev/null; then
  echo "❌ Error: API key required to run examples"
  echo "Run: deepl auth set-key YOUR_API_KEY"
  exit 1
fi

echo "✓ API key configured"
echo

# Parse arguments
STOP_ON_ERROR=false
FAST_MODE=false

for arg in "$@"; do
  case $arg in
    --stop-on-error)
      STOP_ON_ERROR=true
      shift
      ;;
    --fast)
      FAST_MODE=true
      shift
      ;;
    --help)
      echo "Usage: ./examples/run-all.sh [OPTIONS]"
      echo ""
      echo "Options:"
      echo "  --stop-on-error   Stop running examples after first failure"
      echo "  --fast            Skip slow examples (watch mode, git hooks)"
      echo "  --help            Show this help message"
      exit 0
      ;;
  esac
done

# List of all examples
EXAMPLES=(
  # Core Commands - Translate
  "01-basic-translation.sh"
  "02-file-translation.sh"
  "03-batch-processing.sh"
  "04-context-aware-translation.sh"
  "05-document-translation.sh"
  "06-document-format-conversion.sh"
  "07-structured-file-translation.sh"
  "08-model-type-selection.sh"
  "09-xml-tag-handling.sh"
  "10-custom-instructions.sh"
  "11-table-output.sh"
  "12-cost-transparency.sh"
  # Core Commands - Write
  "13-write.sh"
  "36-write-extended-languages.sh"
  "37-correct.sh"
  # Core Commands - Voice
  "14-voice.sh"
  # Resources
  "15-glossaries.sh"
  "33-tm-list.sh"
  # Workflow
  "16-watch-mode.sh"
  "17-git-hooks.sh"
  "18-cicd-integration.sh"
  "30-sync-basic.sh"
  "31-sync-ci.sh"
  "32-sync-live-validation.sh"
  "34-sync-laravel-php.sh"
  # Configuration
  "19-configuration.sh"
  "20-custom-config-files.sh"
  "21-cache.sh"
  "22-style-rules.sh"
  "35-style-rules-crud.sh"
  # Information
  "23-usage-monitoring.sh"
  "24-languages.sh"
  "25-detect.sh"
  "26-completion.sh"
  # Administration
  "27-admin.sh"
  # Getting Started
  "28-init.sh"
  # Advanced
  "29-advanced-translate.sh"
)

# Skip slow examples in fast mode
if [ "$FAST_MODE" = true ]; then
  echo "ℹ️  Fast mode enabled - skipping slow examples (16, 17)"
  echo
  EXAMPLES=(
    # Core Commands - Translate
    "01-basic-translation.sh"
    "02-file-translation.sh"
    "03-batch-processing.sh"
    "04-context-aware-translation.sh"
    "05-document-translation.sh"
    "06-document-format-conversion.sh"
    "07-structured-file-translation.sh"
    "08-model-type-selection.sh"
    "09-xml-tag-handling.sh"
    "10-custom-instructions.sh"
    "11-table-output.sh"
    "12-cost-transparency.sh"
    # Core Commands - Write
    "13-write.sh"
    "36-write-extended-languages.sh"
    "37-correct.sh"
    # Core Commands - Voice
    "14-voice.sh"
    # Resources
    "15-glossaries.sh"
    # Workflow (watch/hooks skipped)
    "18-cicd-integration.sh"
    "30-sync-basic.sh"
    "31-sync-ci.sh"
    "32-sync-live-validation.sh"
    "34-sync-laravel-php.sh"
    # Configuration
    "19-configuration.sh"
    "20-custom-config-files.sh"
    "21-cache.sh"
    "22-style-rules.sh"
    "35-style-rules-crud.sh"
    # Information
    "23-usage-monitoring.sh"
    "24-languages.sh"
    "25-detect.sh"
    "26-completion.sh"
    # Administration
    "27-admin.sh"
    # Getting Started
    "28-init.sh"
    # Advanced
    "29-advanced-translate.sh"
  )
fi

# Run each example and track results
PASSED=()
FAILED=()
TOTAL=${#EXAMPLES[@]}
CURRENT=0

for script in "${EXAMPLES[@]}"; do
  CURRENT=$((CURRENT + 1))
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo "Running example $CURRENT/$TOTAL: $script"
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo

  if bash "examples/$script"; then
    echo
    echo "✅ Example $script passed"
    PASSED+=("$script")
  else
    echo
    echo "❌ Example $script failed"
    FAILED+=("$script")

    if [ "$STOP_ON_ERROR" = true ]; then
      echo
      echo "Stopping due to --stop-on-error flag"
      break
    fi
  fi

  echo
  echo
done

# Summary report
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "=== Summary ==="
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo
echo "Total examples: $TOTAL"
echo "Passed: ${#PASSED[@]}"
echo "Failed: ${#FAILED[@]}"
echo

if [ ${#FAILED[@]} -eq 0 ]; then
  echo "✅ All examples passed successfully!"
  echo
  exit 0
else
  echo "❌ Some examples failed:"
  for script in "${FAILED[@]}"; do
    echo "   - $script"
  done
  echo
  exit 1
fi
