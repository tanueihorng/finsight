# FEAT-002: Investment Lenses & Council Mode

- **ID:** FEAT-002
- **Status:** Selected 2026-10-28; experimental implementation on feature/investment-council, default off
- **Priority:** High
- **Related Tasks:** `MULTIAGENT-001`

> Draft requirements below are proposals, not accepted implementation or execution authority. Broker endpoints, authentication, routing and model behavior require verification when this work is explicitly selected. Current read-only rules remain in force.

---

## 1. Summary
Allow the user to evaluate investment ideas through diverse analytical perspectives without compromising safety guardrails. Implements two complementary modes:
1. **Single-Lens Mode:** Switchable analytical personas (Growth/VC, Speculative/Catalyst, Hedge Fund, Macro/Central Bank, Institutional Risk Officer).
2. **Investment Council Mode:** A multi-perspective debate skill (`/committee`) that automatically convenes 3 analysts (Growth, Macro, Risk) and a synthesis Chair in a structured report.

---

## 2. Requirements & Acceptance Criteria

### A. Architectural Guardrails
- [ ] Base system prompt rules remain **100% frozen** across all lenses: no LLM arithmetic, untrusted data wrapping, read-only boundaries, and SGD reporting.
- [ ] Lenses alter *research emphasis and valuation frameworks*, never user policy limits, accepted rules, or portfolio holdings.

### B. Single-Lens Mode
- [ ] Provide 5 core lenses:
  * **Balanced / CRO (Default):** Capital preservation, concentration check, downside stress, policy conformance.
  * **Growth / VC:** TAM expansion, unit economics, gross margin durability, product moats, secular tailwinds.
  * **Speculative / Catalyst:** Near-term catalysts, asymmetric risk/reward, dilution, strict invalidation points.
  * **Hedge Fund / Special Situations:** Variant perception, positioning/crowding, hedge viability, downside floor.
  * **Macro / Central Bank:** Monetary policy cycles, yield curve sensitivity, liquidity conditions, inflation impact.
- [ ] Toggleable via chat command (`/lens growth`) or an accessible UI dropdown.
- [ ] The active lens is recorded immutably with the turn in SQLite so past answers preserve historical context.

### C. Council Mode (The "Investment Committee" Pattern)
- [ ] Triggered via `/committee <symbol>` or `/debate <symbol>`.
- [ ] Generates a single, highly structured debate report:
  1. **Bull Case (Growth):** The secular upside and expansion thesis.
  2. **Macro View (Central Bank):** Rate sensitivity and economic cycle fit.
  3. **Risk Defense (Risk Officer):** Actual portfolio concentration impact, correlation with existing holdings, and invalidation triggers.
  4. **Chair Synthesis:** Clear trade-off matrix for the user as the final decision-maker.
- [ ] Fixed delegation budget (no infinite recursive multi-agent loops; aggregate token cost capped within turn limits).


## Implementation scope approved 2026-10-28

User approved three specialists (Business & Growth, Macro & Valuation, Portfolio
Risk), a separate chair, single lenses, bounded execution and synthetic testing
before live-trial approval. See [runtime and rollout contract](../../agent/docs/COUNCIL.md).
The earlier draft is retained above; this dated scope refines it. No forced bull
case, no automatic invocation and no claim of independent source confirmation.
Live comparative evaluation, model usefulness and production activation remain
unverified. No paid trials have been run for this implementation.
