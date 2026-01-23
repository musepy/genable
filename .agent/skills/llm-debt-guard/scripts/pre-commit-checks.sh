#!/bin/bash
# LLM Debt Guard - Pre-commit Quality Checks
# Run this script before committing code that involves async/state logic

set -e

SRC_DIR="${1:-src}"
echo "🔍 Running LLM Debt Guard checks on: $SRC_DIR"
echo "================================================"

# Check 1: TODO/FIXME/HACK residuals
echo ""
echo "📋 Check 1: TODO/FIXME/HACK Residuals"
echo "--------------------------------------"
if grep -rn "TODO\|FIXME\|HACK" "$SRC_DIR" --include="*.ts" --include="*.tsx" 2>/dev/null | head -20; then
    echo "⚠️  Found TODO/FIXME/HACK comments above. Please resolve before committing."
else
    echo "✅ No TODO/FIXME/HACK residuals found."
fi

# Check 2: window.location misuse
echo ""
echo "📋 Check 2: window.location Usage"
echo "----------------------------------"
if grep -rn "window.location" "$SRC_DIR" --include="*.ts" --include="*.tsx" 2>/dev/null; then
    echo "⚠️  Found window.location usage. Consider state-based navigation instead."
else
    echo "✅ No window.location usage found."
fi

# Check 3: Missing loading state patterns
echo ""
echo "📋 Check 3: Potential Missing Loading States"
echo "---------------------------------------------"
if grep -rn "useState.*false.*//.*loading\|isLoading\|isInitialized" "$SRC_DIR" --include="*.tsx" 2>/dev/null | head -10; then
    echo "ℹ️  Found loading state patterns above. Verify they follow the three-state pattern."
else
    echo "✅ No suspicious loading state patterns found."
fi

# Check 4: useEffect + useState without loading state
echo ""
echo "📋 Check 4: Async Patterns Without Loading State"
echo "-------------------------------------------------"
if grep -rn "useEffect.*=>" "$SRC_DIR" --include="*.tsx" -l 2>/dev/null | while read file; do
    if ! grep -q "isLoading\|loading\|isInitialized" "$file" 2>/dev/null; then
        echo "  ⚠️  $file: Has useEffect but may lack loading state"
    fi
done; then
    :
fi

echo ""
echo "================================================"
echo "✅ LLM Debt Guard checks complete!"
