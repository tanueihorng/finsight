#!/bin/bash
# Installs a macOS launchd agent so the terminal server starts automatically at
# login (and restarts if it crashes). This is what makes background price alerts
# work even when no browser is open.
#
#   ./install-autostart.sh        # install + start now
#   ./uninstall-autostart.sh      # remove
set -e

DIR="$(cd "$(dirname "$0")" && pwd)"
NODE="$(command -v node || true)"
if [ -z "$NODE" ]; then
  echo "ERROR: could not find 'node' in PATH. Install Node.js (>=18) first."
  exit 1
fi

LABEL="com.finsight.terminal"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
PORT="${PORT:-8000}"
mkdir -p "$HOME/Library/LaunchAgents" "$DIR/data"

cat > "$PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key>
  <array>
    <string>$NODE</string>
    <string>$DIR/server.js</string>
  </array>
  <key>WorkingDirectory</key><string>$DIR</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PORT</key><string>$PORT</string>
  </dict>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>$DIR/data/server.log</string>
  <key>StandardErrorPath</key><string>$DIR/data/server.err.log</string>
</dict>
</plist>
EOF

# Validate then (re)load.
plutil -lint "$PLIST" >/dev/null
launchctl unload "$PLIST" 2>/dev/null || true
launchctl load -w "$PLIST"

echo "Installed launchd agent: $PLIST"
echo "Node:    $NODE"
echo "Running: http://localhost:$PORT  (auto-starts at login, restarts on crash)"
echo "Logs:    $DIR/data/server.log"
echo "Remove with: ./uninstall-autostart.sh"
