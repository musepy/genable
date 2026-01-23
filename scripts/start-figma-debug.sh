#!/bin/bash
# Start Figma with Chrome DevTools Protocol remote debugging enabled
# This allows external tools to connect and capture console.log output
#
# IMPORTANT: Before using this script, enable Developer VM in Figma:
#   Plugins > Development > Use Developer VM (check this option)

set -e

DEBUG_PORT=9222

echo "🔧 Figma CDP Debug Launcher"
echo "═══════════════════════════════════════════════════════"
echo ""
echo "⚠️  Prerequisites:"
echo "   1. In Figma: Plugins > Development > Use Developer VM ✓"
echo "   2. Have your plugin loaded in Figma"
echo ""

# Check if Figma is already running
if pgrep -x "Figma" > /dev/null; then
    echo "⚠️  Figma is already running. Killing existing instance..."
    killall Figma 2>/dev/null || true
    sleep 2
fi

# Check if port is already in use by another process
if lsof -i :$DEBUG_PORT > /dev/null 2>&1; then
    echo "⚠️  Port $DEBUG_PORT in use. Attempting to free it..."
    lsof -ti :$DEBUG_PORT | xargs kill -9 2>/dev/null || true
    sleep 1
fi

echo "🚀 Starting Figma with remote debugging on port $DEBUG_PORT..."

# Use the 'open' command with args - this is the correct way on macOS
open -a "Figma" --args --remote-debugging-port=$DEBUG_PORT

echo ""
echo "⏳ Waiting for Figma to start..."
sleep 5

# Verify the debug endpoint is available
if curl -s "http://localhost:$DEBUG_PORT/json" > /dev/null 2>&1; then
    echo "✅ Debug port $DEBUG_PORT is active!"
    echo ""
    
    TARGETS=$(curl -s "http://localhost:$DEBUG_PORT/json")
    COUNT=$(echo "$TARGETS" | grep -c '"id"' || echo "0")
    
    if [ "$COUNT" -gt 0 ]; then
        echo "📋 Found $COUNT debug target(s):"
        echo "$TARGETS" | grep -E '"title"|"type"' | head -20
    else
        echo "📋 No debug targets yet. This is normal on fresh start."
        echo ""
        echo "👉 Next steps:"
        echo "   1. Open a Figma file with your plugin"
        echo "   2. Open Plugin DevTools: Plugins > Development > Open Console"
        echo "   3. Run: npx ts-node scripts/cdp-log-reader.ts"
    fi
else
    echo "❌ Failed to connect to debug endpoint"
    echo "   Try restarting and check if port 9222 is available"
    exit 1
fi

