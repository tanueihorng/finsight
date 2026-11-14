# FEAT-019 · Thesis change review

Deferred proposal, 2026-11-11 SGT. No execution task is assigned.

## User outcome

Open a company after earnings and see what changed since the last review, which saved assumptions the evidence touches, and what still needs a judgment. This builds on the thesis tracker and event radar in the process branches and on Kestrel's existing research tools.

## First release

- Begin with an on-demand review of one US equity and one recent filing or earnings release. Use a user-saved prior review as the baseline. Each comparison links to dated source evidence and shows units, currency and reporting period.
- Present the changed figures, the assumptions or invalidation conditions they relate to, and evidence gaps. Compute comparable numeric changes in code. Kestrel can draft the explanation and link evidence to a proposed assumption update.
- Let the user accept, edit or dismiss the draft. Preserve the previous review and the source links. A draft review carries no authority to change a thesis, policy or trade. No automatic monitoring or delivery is in scope.
- Start with a synthetic baseline, a filing fixture and a manual trigger. The integrated flow depends on the thesis tracker landing. The comparison and presentation can be prototyped against a fixture first.

## Acceptance

- Given a baseline and a compatible new period, the review reproduces the expected numeric deltas and links each one to its inputs. A currency mismatch, incompatible metric, restatement or missing prior period gets an explicit state.
- Reopening the same source and baseline does not duplicate the review. An explicitly saved review becomes the baseline for the next comparison while earlier versions remain inspectable.
- Fixtures cover a trigger met, no material change and insufficient evidence. A filing or model response cannot approve an update.
