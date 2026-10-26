# FEAT-001: Interactive Brokers (IBKR) MCP Integration & Live Sync

- **ID:** FEAT-001
- **Status:** Deferred proposal; not selected for implementation
- **Priority:** High
- **Related:** `MULTIAGENT-001` (deferred architecture), `ADR-001`; CSV trade import is separately FEAT-008 / IBKRTRADES-001

> Draft requirements below are proposals, not accepted implementation or execution authority. Broker endpoints, authentication, routing and model behavior require verification when this work is explicitly selected. Current read-only rules remain in force.

---

## 1. Summary
Integrate Interactive Brokers into FinSight using the Model Context Protocol (MCP). By implementing an MCP Client inside Kestrel, FinSight can connect directly to IBKR’s native MCP server (or local gateway), replacing manual Activity Statement CSV uploads with automated real-time position/dividend synchronization, closing balance-sheet blind spots (margin debt, borrowing rates), and enabling policy-checked staged order drafting.

---

## 2. Requirements & Acceptance Criteria

### A. Live State & Liabilities Synchronization
- [ ] Connect Kestrel to IBKR MCP via `@modelcontextprotocol/sdk/client`.
- [ ] Support both local IBKR Client Portal Gateway (Docker on `127.0.0.1:5000`) and IBKR public OAuth endpoint.
- [ ] Fetch live execution history without duplicating existing manual ledger entries.
- [ ] Expose live margin loan balances, interest rates, and liquidation buffers to resolve the *"Liabilities such as loans are not in FinSight"* constraint.
- [ ] Normalize all multi-currency amounts (USD, HKD, EUR) to the user's base reporting currency (SGD).

### B. Trade Execution Safety & Staged Order Flow
- [ ] **Strict adherence to ADR-001:** No autonomous trade execution authority.
- [ ] Read tools (`ibkr_get_positions`, `ibkr_get_balances`, `ibkr_get_margin`) mounted in standard chat tool loop.
- [ ] Write tools (`ibkr_place_order`, `ibkr_preview_order`) strictly isolated behind the staged order flow.
- [ ] When a trade idea passes the pre-trade checklist against `INVESTMENT_POLICY.md`, render an interactive **Staged Order Ticket** (`render_ui`).
- [ ] Staged order ticket provides:
  1. Symbol, action, limit price, share count, risk dollar amount, and stop-loss level.
  2. One-click deep link to Interactive Brokers app / Web Portal.
  3. One-click "Copy to Clipboard" formatted order spec.
  4. Optional: If broker API routing is enabled, requires physical entry of FinSight PIN before dispatch.

### C. Operational Resilience & Security
- [ ] Handle IBKR 2FA daily session expiration with an explicit UI status badge (`Active` / `Expired` / `Offline`).
- [ ] Store broker OAuth tokens and API secrets exclusively in macOS Keychain (`finsight-agent`), never in code or logs.
- [ ] Test extensively in IBKR Paper Trading mode before connecting live accounts.
