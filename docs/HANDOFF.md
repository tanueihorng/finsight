# Agent handoff

The latest state for the next coding agent (Claude, Codex or other) and the first checks to run. This file is in git so it reaches every machine. The investment workspace's `harness/STATE.md` (local only) holds older run history and points here.

Update this file when you hand work off. Replace stale sections instead of adding to them.

---

## Current handoff — 2026-11-17 SGT

The owner switched Claude accounts. The owner then asked to land the finished feature branches, and two PRs are now open (below). Start nothing else without the owner's request.

### Where things stand

- `origin/main` is at `e0c00d0`, the merge of [tanueihorng/finsight#6](https://github.com/tanueihorng/finsight/pull/6) (this handoff file). The last code change is `bc02d4a`, the merge of [#5](https://github.com/tanueihorng/finsight/pull/5); CI on that push passed. #6 was docs-only, so CI skipped it.
- **Merged on 2026-11-17:**
  - [#4](https://github.com/tanueihorng/finsight/pull/4) (`21cac17`):
    - exchange-day fix for VWAP, pivots and the session profile (`62b4c89`)
    - the `detail-390-light` visual baseline
    - specs FEAT-018 to FEAT-028
    - a merge of `main` that resolved docs-only conflicts
  - [#5](https://github.com/tanueihorng/finsight/pull/5) (`bc02d4a`): GitHub Actions CI. See [CI](#ci) below.
- **Not deployed.** The owner's personal app has not been restarted on either change. Restart or deploy only on the owner's approval.
- **The owner's local `main` is held by a Codex worktree that has another session's uncommitted changes** (agent Keychain secrets work in `agent/src/secrets.ts`, `agent/src/cli.ts`, `agent/README.md` and a new `agent/test/secrets-keychain.test.ts`). Don't touch it without asking. Branch new work from `origin/main`.
- **Landed and open (2026-11-17):**
  - [#7](https://github.com/tanueihorng/finsight/pull/7) `feat/etf-look-through` (FEAT-018 LOOKTHROUGH-001, ETF look-through issuer exposure): **merged** at `c636b06`, with CI green.
  - [#8](https://github.com/tanueihorng/finsight/pull/8) `feat/process-tools` (FEAT-017 GUARDRAILS-001 plus FEAT-015 PROCESSTOOLS-001): open, rebased onto `c636b06`. It is verified locally (typecheck, unit tests, agent tests, macOS screenshots) and waiting for CI and the owner's review.
  - To rebase a branch past a conflict in the generated `public/app` bundle, rebuild it with `npm run build` at each conflicting commit. Re-check the 390px screenshot baselines after any change to panel order.
- **`feat/policy-guardrails` is superseded.** Its five commits are in #8. It was never pushed. Delete it only with the owner's approval.
- **Still open from earlier work:**
  - QUANT-001 acceptance reconciliation.
  - A stash, `observability WIP 2026-10-29`, exists.

### Decisions to respect

- **FEAT-028 (IBKR Flex Query sync)** is a deferred proposal. It came from comparing FinSight with Sure (`we-promise/sure`, a household budgeting and bank-sync app). **Sure is AGPLv3 and FinSight is MIT: do not copy, port or translate Sure's code.** Build from IBKR's documentation.
- **Correctness comes before new quant capability**, and commits carry no AI co-author trailer. The owner set both rules earlier.

---

## First checks for the next Claude agent

### 1. Verify that Claude Code memory survived the account switch

Before the switch, an agent said Claude Code's project memory should carry over and labelled that untested. Its reasoning: the memory is plain files under the Claude config folder (`~/.claude/projects/<project-path>/memory/`), not tied to an account, so a different account on the same Mac should load them — unless the new login uses a different config folder (`CLAUDE_CONFIG_DIR`).

Check it, then record the result here:

- [x] Your startup context includes a `MEMORY.md` index with an entry named **"Handoff 2026-11-17"**. If it does, memory carried over.
- [x] `echo "${CLAUDE_CONFIG_DIR:-unset}"` prints `unset`, or a folder that contains `projects/`.
- [x] `ls ~/.claude/projects/ | grep finsight` lists this project's folder, and its `memory/` contains `handoff-2026-11-17.md`.
- [x] The session started in the `finsight/` folder itself, not in a parent folder or a worktree. Memory is keyed by the exact start directory, so another directory gets a separate, empty memory.

**Result (2026-11-17, new account):** memory carried over. The startup `MEMORY.md` index included "Handoff 2026-11-17"; `CLAUDE_CONFIG_DIR` is unset (default `~/.claude`); `~/.claude/projects/-Users-tanueihorng-Desktop-investment-finsight/memory/` holds `handoff-2026-11-17.md`; the session started in `finsight/` itself. Note that each worktree has its own memory folder, so sessions started in a worktree do not see this memory.

**Codex** never reads Claude's memory. It reaches this file through [AGENTS.md](../AGENTS.md).

### 2. Confirm the repo state

- [x] `git fetch && git log --oneline -1 origin/main` is `e0c00d0` or later.
- [x] `gh pr list` shows no unexpected open PRs (none open on 2026-11-17).

---

## CI

Workflow: [`.github/workflows/ci.yml`](../.github/workflows/ci.yml). It runs on every PR and on pushes to `main`; pushes that change only docs skip it.

| Job | Runs | First run |
|---|---|---|
| `changes` | Works out whether anything other than `docs/**`, top-level `*.md` or `LICENSE` changed | — |
| `checks` | Typecheck, unit tests with `TZ=Asia/Singapore`, `check:web` | 38 s |
| `agent` | `uv sync --project agent/quant --frozen`, then `agent:test` (including the secret scan) and `quant:test` | 4 min 18 s |
| `e2e` | Playwright `--shard=N/4` on 4 runners | 2 min 17 s to 4 min 56 s |
| `CI result` | Fails if any job failed or was cancelled; skipped jobs pass | — |

- **Wall time:** about 5 min. The browser suite alone takes about 10.5 min locally on one worker.
- **Caches:** npm, uv, and Playwright browsers keyed on the Playwright version. Only Chromium's headless shell is installed. A newer push cancels the run in progress.
- **Repository settings, changed with the owner's approval on 2026-11-17:**
  - Branch protection on `main` requires `CI result`: not strict, no review requirement, admins not enforced.
  - Auto-merge is allowed. Use the merge-commit method; the history uses merge commits.
  - **Renaming or removing the `CI result` job blocks every PR** until branch protection is updated to match.
- **Screenshot tests do not run in CI.** CI sets `E2E_SKIP_VISUAL=1`, which leaves out `visual.spec.ts` because its baselines are macOS-only (`*-chromium-darwin.png`). Run them locally before merging UI changes.
- **Locally, run agent tests with `env -u TAVILY_API_KEY`.** One Council test assumes no search key. CI has no keys, so it passes there.
- **Don't run the 4 shards in parallel on one Mac.** CPU contention causes false 30–70 s timeouts. Use CI, or run them one after another with different `E2E_PORT_BASE` values.
- **To make CI faster:** the agent job and the slowest shard set the wall time. Add a fifth shard, or split the quant setup from the agent tests.
