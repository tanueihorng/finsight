# Agent handoff

The latest state for the next coding agent (Claude, Codex or other) and the first checks to run. This file is in git so it reaches every machine. The investment workspace's `harness/STATE.md` (local only) holds older run history and points here.

Update this file when you hand work off. Replace stale sections instead of adding to them.

---

## Current handoff — 2026-11-17 SGT

The owner switched Claude accounts. **No work was in flight.** Start nothing new without the owner's request.

### Where things stand

- `origin/main` is at `bc02d4a`, the merge of [tanueihorng/finsight#5](https://github.com/tanueihorng/finsight/pull/5). CI on that push passed. This handoff file was added after it.
- **Merged on 2026-11-17:**
  - [#4](https://github.com/tanueihorng/finsight/pull/4) (`21cac17`):
    - exchange-day fix for VWAP, pivots and the session profile (`62b4c89`)
    - the `detail-390-light` visual baseline
    - specs FEAT-018 to FEAT-028
    - a merge of `main` that resolved docs-only conflicts
  - [#5](https://github.com/tanueihorng/finsight/pull/5) (`bc02d4a`): GitHub Actions CI. See [CI](#ci) below.
- **Not deployed.** The owner's personal app has not been restarted on either change. Restart or deploy only on the owner's approval.
- **The owner's local `main` is held by a Codex worktree that has another session's uncommitted changes** (agent Keychain secrets work in `agent/src/secrets.ts`, `agent/src/cli.ts`, `agent/README.md` and a new `agent/test/secrets-keychain.test.ts`). Don't touch it without asking. Branch new work from `origin/main`.
- **Still open from earlier work:**
  - LOOKTHROUGH-001 (FEAT-018) is uncommitted in its worktree.
  - GUARDRAILS-001 and PROCESSTOOLS-001 are unmerged.
  - QUANT-001 acceptance reconciliation is still open.
  - A stash, `observability WIP 2026-10-29`, exists.

### Decisions to respect

- **FEAT-028 (IBKR Flex Query sync)** is a deferred proposal. It came from comparing FinSight with Sure (`we-promise/sure`, a household budgeting and bank-sync app). **Sure is AGPLv3 and FinSight is MIT: do not copy, port or translate Sure's code.** Build from IBKR's documentation.
- **Correctness comes before new quant capability**, and commits carry no AI co-author trailer. The owner set both rules earlier.

---

## First checks for the next Claude agent

### 1. Verify that Claude Code memory survived the account switch

Before the switch, an agent said Claude Code's project memory should carry over and labelled that untested. Its reasoning: the memory is plain files under the Claude config folder (`~/.claude/projects/<project-path>/memory/`), not tied to an account, so a different account on the same Mac should load them — unless the new login uses a different config folder (`CLAUDE_CONFIG_DIR`).

Check it, then record the result here:

- [ ] Your startup context includes a `MEMORY.md` index with an entry named **"Handoff 2026-11-17"**. If it does, memory carried over.
- [ ] `echo "${CLAUDE_CONFIG_DIR:-unset}"` prints `unset`, or a folder that contains `projects/`.
- [ ] `ls ~/.claude/projects/ | grep finsight` lists this project's folder, and its `memory/` contains `handoff-2026-11-17.md`.
- [ ] The session started in the `finsight/` folder itself, not in a parent folder or a worktree. Memory is keyed by the exact start directory, so another directory gets a separate, empty memory.

**Result:** _not yet checked_. Replace this with the date, what you found, and the account or config folder in use. If memory did not load, say so plainly, and treat this file as the source of truth.

**Codex** never reads Claude's memory. It reaches this file through [AGENTS.md](../AGENTS.md).

### 2. Confirm the repo state

- [ ] `git fetch && git log --oneline -1 origin/main` is `bc02d4a` or later.
- [ ] `gh pr list` shows no unexpected open PRs.

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
