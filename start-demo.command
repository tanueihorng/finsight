#!/bin/bash
# Double-click: FinSight + agent in DEMO MODE on a made-up portfolio (~/FinSightDemo).
# Your real data is never used. Close this window or press Ctrl-C to stop.
cd "$(dirname "$0")" && exec node scripts/demo.js "$@"
