#!/bin/bash
# Double-click this file to start the terminal (keeps running in this window).
# Close the window or press Ctrl-C to stop it.
cd "$(dirname "$0")" || exit 1
unset OPENAI_API_KEY
export FINSIGHT_DATA_DIR="$HOME/FinSightStandalone"
export AGENT_HOME="$FINSIGHT_DATA_DIR/agent"
export RECORDS_DIR="$FINSIGHT_DATA_DIR/records"
export PORT=8002
export AGENT_URL=http://127.0.0.1:8102
export AGENT_SHELL_ENV=0
unset FINSIGHT_DEMO_MODE AGENT_DIR AGENT_PORT
if ! node -e 'process.exit(Number(process.versions.node.split(".")[0]) >= 24 ? 0 : 1)' 2>/dev/null; then
  echo "FinSight needs Node.js 24 or newer (found: $(node -v 2>/dev/null || echo none)). Install the current LTS from https://nodejs.org"
  read -r -p "Press Enter to close."; exit 1
fi
if ! node scripts/check-launcher-path.ts --check-config "$FINSIGHT_DATA_DIR" "$HOME/FinSightData" "$HOME/FinSightDemo" ||
   ! node scripts/check-launcher-path.ts "$AGENT_HOME" "$HOME/FinSightData" "$HOME/FinSightDemo" ||
   ! node scripts/check-launcher-path.ts "$RECORDS_DIR" "$HOME/FinSightData" "$HOME/FinSightDemo"; then
  echo "Standalone data folder overlaps personal or demo storage. Refusing to start."
  read -r -p "Press Enter to close."; exit 1
fi
echo "Starting FinSight standalone (data: $FINSIGHT_DATA_DIR) ..."
echo "Open http://localhost:$PORT in your browser."
exec node server.ts
