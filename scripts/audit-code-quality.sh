#!/bin/bash
set -o pipefail

REPORT_FILE="audit-report.md"
echo "# Code Quality Audit Report" > "$REPORT_FILE"
echo "Date: $(date)" >> "$REPORT_FILE"
echo "" >> "$REPORT_FILE"
echo "## Violations Summary" >> "$REPORT_FILE"
echo "| Severity | Rule | Count |" >> "$REPORT_FILE"
echo "|---|---|---|" >> "$REPORT_FILE"

# Function to run audit
audit() {
    local severity=$1
    local name=$2
    local pattern=$3
    local exclude_pattern=$4
    
    echo "Running audit: $name..."
    
    # Run git grep
    # -E: Extended Regex
    # -I: Ignore binary
    # -n: Line numbers
    if [ -z "$exclude_pattern" ]; then
        match_count=$(git grep -EI "$pattern" -- src/ | wc -l | tr -d ' ')
    else
        match_count=$(git grep -EI "$pattern" -- src/ | grep -vE "$exclude_pattern" | wc -l | tr -d ' ')
    fi
    
    echo "| $severity | $name | $match_count |" >> "$REPORT_FILE"
    
    if [ "$match_count" -gt 0 ]; then
        echo "" >> "$REPORT_FILE"
        echo "### [$severity] $name ($match_count matches)" >> "$REPORT_FILE"
        echo '```' >> "$REPORT_FILE"
        if [ -z "$exclude_pattern" ]; then
            git grep -nEI "$pattern" -- src/ | head -n 20 >> "$REPORT_FILE"
        else
            git grep -nEI "$pattern" -- src/ | grep -vE "$exclude_pattern" | head -n 20 >> "$REPORT_FILE"
        fi
        if [ "$match_count" -gt 20 ]; then
            echo "... (truncated, total $match_count)" >> "$REPORT_FILE"
        fi
        echo '```' >> "$REPORT_FILE"
    fi
}

echo "Starting Fast Audit (using git grep)..."

# 1. Typography (P1)
# exclude tokens definition files and usage of var or tokens
audit "P1" "Hardcoded fontSize" "fontSize: [0-9]+" "tokens\.|var\(--|design-system"
audit "P1" "Legacy fontSize aliases" "fontSize\.(xs|sm|lg|base|xl)" "design-system"
audit "P1" "Hardcoded lineHeight" "lineHeight: [0-9]\." "tokens\."
audit "P1" "Hardcoded fontWeight" "fontWeight: [0-9]+" "tokens\."

# 2. Styles (P2)
audit "P2" "Hardcoded borderRadius" "borderRadius: [0-9]+" "var\(--"
audit "P2" "Hardcoded Hex Colors" "#[0-9a-fA-F]{6}" "tokens"
audit "P3" "Hardcoded rgba" "rgba\("
audit "P3" "Hardcoded opacity" "opacity: 0\."

# 3. Motion (P2)
audit "P2" "Unstable Hover Scale" "scale\(1\.[0-9]"

# 4. Security
audit "CRITICAL" "Exposed API Key" "API_KEY\s*="
audit "WARNING" "console.log usage" "console\.log"

echo "Audit complete. Report generated at $REPORT_FILE"
