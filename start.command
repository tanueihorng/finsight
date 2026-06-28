#!/bin/bash
# Double-click this file to start the terminal (keeps running in this window).
# Close the window or press Ctrl-C to stop it.
cd "$(dirname "$0")"
echo "Starting FINSIGHT // PERSONAL TERMINAL ..."
echo "Open http://localhost:8000 in your browser."
exec node server.js
