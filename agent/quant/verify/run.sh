#!/bin/sh
# Full independent verification of the quant worker. Uses synthetic data unless
# LIVE_SYMBOLS and an isolated FINSIGHT_DATA_DIR are set. Add --mutate to also
# measure, by injecting bugs, whether these checks catch them.
set -eu
cd "$(dirname "$0")/.."
export PYTHONDONTWRITEBYTECODE=1
UV_PROJECT_ENVIRONMENT=.venv-verify uv sync --group verify --quiet
python=.venv-verify/bin/python

"$python" -W ignore -m verify.check_replay
"$python" -W ignore -m verify.check_validation

export_file="$(mktemp)"
trap 'rm -f "$export_file"' EXIT
(cd .. && node quant/verify/export_engine.ts "$export_file")
"$python" -W ignore -m verify.check_engine "$export_file"

if [ "${1:-}" = "--mutate" ]; then
  "$python" -W ignore -m verify.mutate
fi
