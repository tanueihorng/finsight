# FEAT-006: Trade sheet: + ADD opens the sheet for a new symbol

- Execution task: `TRADENEW-001`
- Status: Selected; implementation and verification owned by the existing feature session.
- Active checkout in the investment workspace: `finsight-wt/open-features` (`feature/open-features`).
- This contract does not claim merge, deployment or confirmed execution.

## Objective

Logged by user 2026-10-26. + ADD and the setup wizard still open the old inline add form. Let the trade sheet start with symbol search (reuse /api/search) so a new holding is bought through the same sheet, then retire or keep the inline form as a fallback. Builds on the trade sheet, merged into FinSight main e0da6ee on 2026-10-26.

## Acceptance

- [ ] + ADD opens the sheet with a symbol search; picking a result fills price from the quote
- [ ] New-symbol buy records a dated lot exactly like the inline form (same API, same status text)
- [ ] Setup wizard 'add manually' still works; e2e specs using #add-* updated or kept passing; typecheck/unit/check:web/e2e pass

## Stop condition

Verified isolated implementation and handoff; no merge/push without the user's say.
