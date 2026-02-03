#!/bin/bash

# Figma AI Generator: Agentic Transformation Initialization Script
# This script ensures the environment is ready for testing and development.

echo "🚀 Initializing Agentic Transformation Workspace..."

# 1. Check dependencies (npm install if node_modules missing)
if [ ! -d "node_modules" ]; then
    echo "📦 Installing dependencies..."
    npm install
fi

# 2. Run Linters to ensure code quality
echo "🔍 Running Linters..."
npm run lint --silent

# 3. Check for structural tracking files
echo "📊 Checking tracking files..."
FILES=("turn to agent/state_tracking.md" "turn to agent/state_example.json" "turn to agent/tests.json")
for file in "${FILES[@]}"; do
    if [ ! -f "$file" ]; then
        echo "⚠️ Warning: $file is missing."
    else
        echo "✅ Found $file"
    fi
done

# 4. Preparation for Test Execution
# Note: Specific test commands will be added as test files are created.
echo "🧪 Ready to run tests."

echo "✨ Initialization complete."
