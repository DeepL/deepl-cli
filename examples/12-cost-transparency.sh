#!/bin/bash
# Example 12: Cost Transparency with Billed Characters
# Demonstrates tracking actual billed characters for translation cost analysis

set -e  # Exit on error

echo "=== DeepL CLI Example 12: Cost Transparency ==="
echo

# Check if API key is configured
if ! deepl auth show &>/dev/null; then
  echo "❌ Error: API key not configured"
  echo "Run: deepl auth set-key YOUR_API_KEY"
  exit 1
fi

echo "✓ API key configured"
echo

# Create temporary directory for file examples
TEMP_DIR="/tmp/deepl-example-12"
mkdir -p "$TEMP_DIR"

# Example 1: Basic text translation with billed character count
echo "1. Basic translation with billed character count"
echo "   Translating a short phrase..."
deepl translate "Hello, world!" --to es --show-billed-characters
echo

# Example 2: Multiple target languages
echo "2. Multiple target languages cost tracking"
echo "   Translating to Spanish, French, and German..."
deepl translate "Welcome to our platform" --to es,fr,de --show-billed-characters
echo

# Example 3: Longer text to see character billing
echo "3. Longer text with detailed character billing"
echo "   Translating a paragraph..."
deepl translate "This is a longer text example to demonstrate how character billing works. The DeepL API charges based on the actual characters sent, not the characters in the translated output." --to es --show-billed-characters
echo

# Example 4: File translation cost tracking
echo "4. File translation with cost tracking"
echo "   Creating a sample markdown file..."
cat > "$TEMP_DIR/sample.md" << 'EOF'
# Product Documentation

## Overview
This is a sample document for translation cost analysis.

## Features
- Feature 1: High-quality translation
- Feature 2: Cost transparency
- Feature 3: Easy integration

## Conclusion
Understanding translation costs helps with budget planning.
EOF

echo "   Translating markdown file..."
deepl translate "$TEMP_DIR/sample.md" --to es --output "$TEMP_DIR/sample.es.md" --show-billed-characters
echo

# Example 5: Compare cached vs non-cached costs
echo "5. Cache impact on billing (cached translations are not billed)"
echo "   First translation (billed)..."
RESULT1=$(deepl translate "Testing cache billing" --to fr --show-billed-characters)
echo "$RESULT1"
echo

echo "   Second translation (cached - should show cached result)..."
RESULT2=$(deepl translate "Testing cache billing" --to fr --show-billed-characters)
echo "$RESULT2"
echo

# Example 6: JSON output for cost analysis scripts
echo "6. JSON output for automated cost tracking"
echo "   Getting machine-readable output..."
deepl translate "API integration example" --to es --show-billed-characters --format json
echo
echo

# Example 7: Code preservation impact on billing
echo "7. Code preservation and character billing"
echo "   Creating a technical document with code..."
cat > "$TEMP_DIR/technical.md" << 'EOF'
# Installation Guide

Install DeepL CLI from source (see the project README).

Then configure your API key: `deepl auth set-key YOUR_KEY`
EOF

echo "   Translating with code preservation..."
deepl translate "$TEMP_DIR/technical.md" --to es --output "$TEMP_DIR/technical.es.md" --preserve-code --show-billed-characters
echo

# Example 8: Batch operation cost estimation
echo "8. Batch operation cost tracking"
echo "   Creating multiple test files..."
for i in {1..3}; do
  echo "This is test file number $i with some content for translation." > "$TEMP_DIR/file$i.txt"
done

echo "   Translating directory with cost tracking..."
echo "   (Note: Individual file costs shown during batch operations)"
deepl translate "$TEMP_DIR" --to es --output "$TEMP_DIR/es-output" --pattern "*.txt" --show-billed-characters
echo

# Example 9: Cost tracking script for CI/CD
echo "9. Automated cost tracking in scripts"
echo "   Example bash script for budget monitoring:"
echo
cat << 'EOF'
#!/bin/bash
# Cost tracking script example

# Translate and capture output
OUTPUT=$(deepl translate "Text to translate" --to es --show-billed-characters 2>&1)

# Extract billed characters from output (example parsing)
if echo "$OUTPUT" | grep -q "Billed characters:"; then
  CHARS=$(echo "$OUTPUT" | grep "Billed characters:" | grep -oE '[0-9,]+' | tr -d ',')
  echo "Translation cost: $CHARS characters"

  # Check if exceeds budget
  BUDGET=1000
  if [ "$CHARS" -gt "$BUDGET" ]; then
    echo "⚠️  Warning: Translation exceeded budget ($CHARS > $BUDGET chars)"
  fi
fi
EOF
echo

# Cleanup
echo "10. Cleaning up temporary files..."
rm -rf "$TEMP_DIR"
echo "    ✓ Cleanup complete"
echo

echo "=== All examples completed successfully! ==="
echo

echo "💡 Cost transparency benefits:"
echo "   - Accurate billing visibility"
echo "   - Budget planning and forecasting"
echo "   - Cost optimization opportunities"
echo "   - Transparent API usage tracking"
echo

echo "📊 Cost tracking tips:"
echo "   - Use --show-billed-characters for budget-sensitive operations"
echo "   - Track costs per project or feature"
echo "   - Leverage caching to reduce API costs"
echo "   - Monitor costs in CI/CD pipelines"
echo "   - Combine with JSON output for automated cost analysis"
echo

echo "💰 Understanding billing:"
echo "   - Billed characters = actual characters sent to API"
echo "   - Cached translations are not billed again"
echo "   - Multiple target languages multiply the cost"
echo "   - Whitespace and formatting may affect character count"
echo "   - Code blocks (with --preserve-code) are included in billing"
echo

echo "🔍 Cost optimization strategies:"
echo "   - Enable caching to avoid repeat charges"
echo "   - Use glossaries to ensure consistency (no re-translation)"
echo "   - Batch translations efficiently"
echo "   - Monitor usage with 'deepl usage' command"
echo "   - Translate only changed content in watch mode"
echo
