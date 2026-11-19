#!/bin/sh
# Differential check: replays one scripted API session against a base ref
# (default origin/main) and this checkout, and fails on any difference not
# listed in the allow file. Use it for refactors and migrations that should not
# change behaviour; intended changes go in an allow file (--allow <file.json>).
#   npm run verify:diff [-- <base-ref>] [--allow <file.json>] [--verbose]
set -eu
root=$(cd "$(dirname "$0")/.." && pwd)
ref=origin/main
case "${1:-}" in ''|--*) ;; *) ref=$1; shift ;; esac
base=$(mktemp -d "${TMPDIR:-/tmp}/finsight-diff-base-XXXXXX")
cleanup() { git -C "$root" worktree remove --force "$base" 2>/dev/null || rm -rf "$base"; }
trap cleanup EXIT
git -C "$root" worktree add -q --detach "$base" "$ref"
ln -s "$root/node_modules" "$base/node_modules"
echo "verify:diff: $ref ($(git -C "$base" rev-parse --short HEAD)) vs $(git -C "$root" rev-parse --short HEAD) + working tree"
node "$root/scripts/compare-servers.mjs" --a "$base" --b "$root" "$@"
