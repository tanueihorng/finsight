#!/bin/bash
# Removes the auto-start agent and stops the background server.
LABEL="com.finsight.terminal"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
launchctl unload "$PLIST" 2>/dev/null || true
rm -f "$PLIST"
echo "Auto-start removed. Background server stopped."
echo "(You can still run it manually any time with: node server.js)"
