# Handoff: FinSight frontend migration — current state

Written 2026-10-26 (replaces the 2026-10-25 Phase-2-lane handoff, which described work that has since merged). Read this file first, then `PLAN.md` §0–§3 and the card you are working on. The plan is the authority; this file is the current state and lessons learned.

## Where things stand

- **Phases 0–5 are complete and merged to `main`** (`66b8325`): safety net (P0-1–P0-5), foundation (F1–F6), inventory + pilots (I1, PILOT-1/2), all panel lanes (A1–E2), shell + Kestrel (F7–F10, G1–G3), cutover (X1, X2 — `public/app.js` and `agent-panel.js` are deleted) and hardening (H1–H4). Out-of-plan hardening also merged: AUTHVAL auth-isolation suite, Kestrel review fixes (KESTRELFIX-001), startup fallback (R1) + SW hashed-chunk fallback (R2), deterministic SW recovery tests. Per-card status lives in `PLAN.md` §7 (updated 2026-10-26 to match history).
- **Audited 2026-10-26:** `docs/frontend-migration/AUDIT-PHASE0-5.md`. The gate (`E2E_PORT_BASE=<free base> npm run verify`) is green; 4 E2E tests flaked once on Playwright trace-artifact ENOENT under load and passed on re-run — infrastructure, not product.
- **Next and last planned phase: Phase 6 (S1, S2 — server → TypeScript).** Its prep pack is `docs/frontend-migration/PHASE6-PREP.md`: the required launcher inventory, the exact tsconfig/package.json changes, the ESM conversion surface, and a risk checklist (read risks 1–2 before touching anything: `START-HERE.md` user flow and the offline-message string asserted by `F9.spec.ts`).
- **Rollback:** tag `mig-lkg-phase6` marks the pre-Phase-6 baseline (`66b8325`). Panel cards stay revertable via their `--no-ff` merge commits (PLAN §6).

## If you are starting Phase 6 (S1/S2)

1. Read `PLAN.md` §0 (rules) and the S1/S2 cards, plus `PHASE6-PREP.md` end to end.
2. Work in your own worktree: `git worktree add -b mig/S1-server-ts ../finsight-wt/mig-S1 mig-lkg-phase6` (or current `main` if it has not moved).
3. Convert leaf-first (`lib/` modules with no internal requires, then up to `portfolio`/`market`, then `server.js`), tests alongside; the gate is byte-identical behaviour + `npm run verify` + `npm run agent:test` + zero `server.js` references outside docs/history.
4. `~/FinSightData/start-finsight-personal.command` (outside the repo, runs `node server.js`) must be updated in the same change **with the owner present**.
5. Do not start S2 before S1 is verified; `npm run agent:test` (58 tests) is S2's gate.

## Rules (unchanged, non-negotiable)

- One branch and worktree per card; **never work in the owner's main checkout folder** — the owner runs FinSight from it. Never push. Never merge to `main` yourself; the owner merges.
- Commits: `mig(<card>): <what>`, owner's git identity, **no AI co-author trailers**.
- Never touch `~/FinSightData`, `data/`, or any `*.csv` (the pre-commit hook blocks CSVs). Tests use temp folders only.
- Before reporting a card: `npm run verify` green and `git diff --stat main..` shows only your files.
- E2E ports: pick an `E2E_PORT_BASE` that avoids 8000/8100 (the owner) and 8086+/8096+ (other agents' lanes) — check `lsof -nP -iTCP -sTCP:LISTEN` first. Node 24 (`node --version` → 24.x). After touching `web/src`, run `npm run build` and commit `public/app` with the source (`test/webbuild.test.js` enforces it).

## Housekeeping pending (owner decisions, do not do unasked)

- ~24 worktrees under `../finsight-wt/` and 21 branches whose cards are merged; 3 unmerged branches are stale (`fix/authval-defects`, `fix/e2e-lock-spec` are patch-equivalent to merged commits; `fix/phase2-audit` targets the deleted `app.js` with its findings re-applied by `b37c36e`). Cleanup list is in `AUDIT-PHASE0-5.md` finding 4.
- `main` is ~100 commits ahead of `origin/main` (never pushed, per the rules). Pushing is the owner's call; note finding 6 of the audit (pre-migration history carries AI co-author trailers) first.
