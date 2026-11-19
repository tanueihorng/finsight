---
name: verify
description: Verify a FinSight change by running it. Starts an isolated FinSight on synthetic data, drives the affected features in a browser against the feature map, and reports evidence. Use before committing any change a user could see (web UI, API responses, numbers on screen), and whenever asked to verify, check or prove that a change works.
---

# Verify a FinSight change

A change is verified when you have watched it work in a running app, not when the tests pass. Tests are
evidence too; report them, but this skill covers what they don't.

## Never

- Use the personal app (port 8001, `~/FinSightData`), the demo (8003) or plain `node server.ts` (port 8000,
  the repo's `data/`). `scripts/verify-server.ts` refuses those ports.
- Enter anything but the synthetic PIN `2468` the verify server sets.

## Steps

1. **Pick the features.** Read the diff and choose the rows of [FEATURE-MAP.md](FEATURE-MAP.md) it can affect.
   Add the flows the change introduces. A pure refactor of server code: also run `npm run verify:diff`.
2. **Start the server** in the background from the checkout under test:
   `node scripts/verify-server.ts --port 8091` (any free port; `--empty` skips the demo portfolio).
   Wait for its JSON line `{"ready":true,"url":...}`. If `web/src` changed, run `npm run build` first.
3. **Open it** in the built-in browser (`preview_start` with the URL). Before the first load, mark the setup
   wizard done unless the change concerns it:
   `localStorage.setItem('finsight-profile', JSON.stringify({ setupDone: true }))`, then reload.
   Unlock with PIN `2468`.
4. **Drive each chosen row as a user would**: click, type in the command bar (`#cmd`), drag panels. Read results
   with `get_page_text` or `read_page`; take a screenshot only when layout is the point. Check the browser
   console for errors.
5. **On failure:** diagnose, fix, rebuild, re-run the row. After three failed rounds, stop and report what
   fails, what you tried and your best explanation.
6. **Report evidence**, one line per row: the action, what you expected, what you saw (quote the values).
   Name what you did not or could not check. Put the checks in the commit's `Verified:` line.
7. **Clean up:** stop the server (Ctrl-C or kill its process; it deletes its data folder) and close the tab.

## Keep the map current

If a row's expectation is wrong because the product changed on purpose, update FEATURE-MAP.md in the same
change and say so. If a flow you had to work out by hand will be needed again, add it as a row. Delete rows for
features that no longer exist.
