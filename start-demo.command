#!/bin/bash
# Double-click: FinSight + agent in DEMO MODE on a made-up portfolio (~/FinSightDemo).
# Your real data is never used. Close this window or press Ctrl-C to stop.
cd "$(dirname "$0")" || exit 1
unset OPENAI_API_KEY AGENT_DIR AGENT_PORT
export FINSIGHT_DEMO_DIR="$HOME/FinSightDemo"
export AGENT_SHELL_ENV=0
if ! node -e 'process.exit(Number(process.versions.node.split(".")[0]) >= 24 ? 0 : 1)' 2>/dev/null; then
  echo "FinSight needs Node.js 24 or newer (found: $(node -v 2>/dev/null || echo none)). Install the current LTS from https://nodejs.org"
  read -r -p "Press Enter to close."; exit 1
fi
exec node scripts/demo.ts "$@"
