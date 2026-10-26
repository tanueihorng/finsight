# FEAT-006: Trade sheet: + ADD opens the sheet for a new symbol

- Execution task: `TRADENEW-001`
- Status: Implemented and verified; committed in `22b0436`, integration selected 2026-10-27.
- Active checkout in the investment workspace: `finsight-wt/open-features` (`feature/open-features`).
- This contract does not claim merge, deployment or confirmed execution.

## Objective

Logged by user 2026-10-26. + ADD and the setup wizard still open the old inline add form. Let the trade sheet start with symbol search (reuse /api/search) so a new holding is bought through the same sheet, then retire or keep the inline form as a fallback. Builds on the trade sheet, merged into FinSight main e0da6ee on 2026-10-26.

## Acceptance

- [x] + ADD opens the sheet with a symbol search; picking a result fills price from the quote
- [x] New-symbol buy records a dated lot exactly like the inline form (same API, same status text)
- [x] Setup wizard 'add manually' still works; e2e specs using #add-* updated or kept passing; typecheck/unit/check:web/e2e pass

## Stop condition

Isolated implementation verified. User selected commit, review, merge and push on 2026-10-27; deployment remains separate.


## Implementation and verification

- [x] + ADD and setup wizard Add manually open symbol search in the shared sheet.
- [x] Picking a search result fills the latest quote; dated purchases use the existing buy API and status text.
- [x] Account choice is explicit in All Accounts; validation, errors, undo and keyboard access work.

Synthetic verification: `test/open-features.test.ts`, `web/e2e/D2.spec.ts`, `web/e2e/OPENFEATURES.spec.ts`. No broker execution.
