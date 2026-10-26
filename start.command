#!/bin/bash
# Double-click this file to start the terminal (keeps running in this window).
# Close the window or press Ctrl-C to stop it.
cd "$(dirname "$0")"
if ! node -e 'process.exit(Number(process.versions.node.split(".")[0]) >= 24 ? 0 : 1)' 2>/dev/null; then
  echo "FinSight needs Node.js 24 or newer (found: $(node -v 2>/dev/null || echo none)). Install the current LTS from https://nodejs.org"
  read -r -p "Press Enter to close."; exit 1
fi
echo "Starting FINSIGHT // PERSONAL TERMINAL ..."
echo "Open http://localhost:${PORT:-8000} in your browser."
exec node server.ts
