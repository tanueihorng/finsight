"""Section 25: FinSight reviewed against the 24 software-engineering domains.

Each domain records whether it applies to a single-user local app, what the
code does today (with file evidence), and the honest gaps. Status values:
  core    - applies fully and is implemented
  partial - applies; implemented in part, gaps listed
  scoped  - applies only in a reduced form for a local single-user app
  na      - not applicable by design (reason given)
"""

GROUPS = [
    ("A", "Product and design foundations"),
    ("B", "Application logic and data"),
    ("C", "Security, correctness and system behaviour"),
    ("D", "Delivery, infrastructure and operations"),
    ("E", "Business, governance and sustainability"),
]

# (no, group, name, status, short evidence for the map, [how FinSight addresses it], [gaps / decisions])
DOMAINS = [
    (1, "A", "Product requirements and scope", "core", "PRD · BACKLOG · FEAT specs", [
        "Problem, users and goals: Sections 1–4; `docs/product/PRD.md`.",
        "Functional requirements and user stories with acceptance criteria: Sections 5 and 7 (US-A1…US-F4, FR-*).",
        "Non-functional requirements: Section 8.",
        "Prioritisation and roadmap: `docs/BACKLOG.md` and one spec per feature in `docs/features/FEAT-001…013`, each with scope, non-goals and done criteria.",
        "Change control: a feature is specified before it is built, and `CHANGELOG.md` records what merged with Git references.",
    ], [
        "Success metrics are qualitative (G1–G6). There is no product telemetry by design, so adoption cannot be measured (see domain 22).",
    ]),
    (2, "A", "System architecture", "core", "Two-process modular monolith", [
        "**Modular monolith in two processes**: the FinSight server (`server.ts` + `lib/`) and the Kestrel agent (`agent/`). They talk over loopback HTTP with a shared secret.",
        "Clear boundaries: domain maths in `lib/` (no I/O in the maths), HTTP in `server.ts`, UI in `web/`, agent tools behind one registry.",
        "Synchronous REST for commands; asynchronous SSE for streams (Kestrel events, paper `trade_updates`).",
        "Background work: alert checks, cache refresh, the Alpaca stream and agent turns run off the request path.",
        "Failure boundary: the agent can crash or be absent and the terminal keeps working. The server supervises and restarts it (domain 12).",
        "C4 diagrams in Section 9 (Figures 3–8).",
    ], [
        "Most decisions are recorded in feature specs and architecture notes. There is one formal ADR (`agent/docs/ADR-THINKING-EFFORT.md`), and a `docs/adr/` folder would make the rest easier to find.",
    ]),
    (3, "A", "Technology stack selection", "core", "Node 24 · React 19 · SQLite", [
        "Node 24 runs TypeScript directly. The server has **zero runtime npm dependencies**, which keeps the supply chain small.",
        "Frontend: React 19, TanStack Query, Zustand, esbuild and a custom canvas chart. Agent: better-sqlite3, Zod, the Anthropic and MCP SDKs, Readability, unpdf and mammoth.",
        "All versions are pinned exactly and locked in `package-lock.json`. The license is MIT.",
        "Market data is public and keyless (Yahoo, FRED, World Bank, Nasdaq, SEC). Models are pluggable (DeepSeek, Claude, OpenAI-compatible, Claude Code CLI), which limits vendor lock-in.",
        "Full table in Section 11.",
    ], [
        "Yahoo endpoints are unofficial and can change without notice. This is mitigated by host fallback and the fake market for tests, but it remains a dependency risk (Section 24).",
    ]),
    (4, "A", "Frontend engineering and UX", "core", "React SPA · PWA · axe tests", [
        "Component islands per panel (`web/src/features/*`), state in Zustand stores, server state in TanStack Query.",
        "Loading, empty, stale, error and offline states are explicit: stale quotes are flagged, and the agent shows an offline hint.",
        "Accessibility is tested with axe-core in Playwright (`H3.a11y`, `activity.a11y`). Panels can be reordered from the keyboard. Accessible names match the visible text.",
        "Responsive layout and an installable PWA with a service worker (release-tested in `release.sw.spec.ts`).",
        "Themes, fonts, accent palettes, light mode, and UNPEEK privacy mode for screen sharing.",
    ], [
        "SEO: not applicable. This is a private local app behind a PIN.",
        "i18n: English UI only. Currency and number formatting follow the base currency, and time zones are handled for exchanges and the agent.",
    ]),
    (5, "B", "Backend engineering", "core", "lib/ domain · server.ts HTTP", [
        "Business logic lives in `lib/` modules (portfolio, ledger, performance, dividends, paper, alerts). `server.ts` only routes, validates and serialises.",
        "Input validation at the HTTP boundary. The agent validates every tool input and every config file with Zod.",
        "Errors map to status codes: 400 for user errors, 502 for upstream failures, 409 for version conflicts in the agent.",
        "Configuration through environment variables and `config.json`, documented in Section 21.2.",
        "Background jobs: alert checker, cache refresh, the agent process supervisor and the paper stream with reconnect.",
        "Request lifecycle: Host check, then session check, then route, then a JSON response with `Cache-Control: no-store`.",
    ], [
        "There are no worker pools or queues. A single Node event loop is enough for one user, and CPU-heavy strategy runs go to a sandboxed child process.",
    ]),
    (6, "B", "Database and data architecture", "core", "JSON files + SQLite WAL", [
        "Two stores. The **portfolio** uses JSON documents in `FINSIGHT_DATA_DIR`, with 0600 permissions and atomic temp+rename writes. **Agent state** uses SQLite in WAL mode (`agent.db`).",
        "Schema evolution: `schema_migrations` is versioned, and the DB is **copied to `.bak-vN` before any migration** (`agent/src/store/db.ts`).",
        "Integrity: a corrupt `portfolio.json` is backed up to `.corrupt.json` instead of being overwritten (`lib/store.ts`).",
        "Transactions: SQLite transactions for multi-row agent writes, plus optimistic versions on threads.",
        "Retention: audit logs older than 14 days are pruned at start-up (`logRetentionDays`).",
        "Data model in Section 10.1 (Figure 9).",
    ], [
        "Multi-tenant isolation: not applicable (single user).",
        "Backups of the data folder are the user's job (Time Machine or a copy). There is no built-in scheduled backup or restore drill.",
    ]),
    (7, "B", "APIs and system integration", "core", "REST + SSE · /v1 · Zod", [
        "FinSight `/api/*` is JSON over HTTP. The agent `/v1/*` is versioned, with Zod request schemas.",
        "SSE streams carry event ids and support **replay from Last-Event-ID**, so a dropped stream loses nothing.",
        "**Idempotency**: agent message posts accept idempotency keys. Paper ticket approval is claimed under a lock so it is sent once, and each order carries a unique `client_order_id` (`fs-u-…` for the user, `fs-k-…` for Kestrel).",
        "Timeouts on every outbound fetch (12 s, with a Yahoo host fallback), plus a stale-while-revalidate cache that serves the last good value during an outage.",
        "Kestrel's own rate limits: searches, page fetches, steps and seconds per turn (Section 12.4).",
        "MCP stdio server exposes the same tool registry to external coding agents.",
    ], [
        "No OpenAPI file. The API is documented in Section 10.2 and the agent's `SPEC.md`.",
        "No formal circuit breaker. Upstream failures degrade to cached or stale data instead.",
    ]),
    (8, "B", "Identity and access management", "scoped", "PIN · scrypt · SameSite", [
        "One user and one credential: a PIN hashed with **scrypt** and compared with `timingSafeEqual`, stored 0600 (`lib/auth.ts`).",
        "**Per-IP brute-force throttle** on failed logins, so a third party cannot lock the owner out.",
        "Sessions: random token, `HttpOnly; SameSite=Strict` cookie, idle expiry (`LOCK_IDLE_MIN`, default 480 min), plus an hourly sweep of stale sessions.",
        "**Least privilege for the agent**: Kestrel's token can only place or cancel paper orders. It cannot change settings, limits, keys or the real book.",
        "Audit trail of agent actions (tool calls, orders with origin tags).",
    ], [
        "Registration, OAuth/OIDC, MFA, roles and tenants: not applicable. FinSight is single-user and local.",
        "PIN recovery is manual (delete `auth.json`), which is acceptable for a local owner.",
    ]),
    (9, "C", "Application security", "partial", "STRIDE · SSRF guard · untrusted data", [
        "Threat model: STRIDE in Section 15.2, with trust boundaries in Figure 11.",
        "Loopback bind plus a **Host-header check against DNS rebinding**. Headers: `X-Frame-Options: DENY` and `X-Content-Type-Options: nosniff`.",
        "CSRF is closed by `SameSite=Strict` cookies on a loopback origin.",
        "**SSRF guard** in `fetch_url`: private and local addresses are blocked, DNS is pinned to the socket, and redirects, types and sizes are checked (`agent/src/tools/web.ts`).",
        "**Prompt-injection posture**: uploads and fetched pages are labelled untrusted data in the system prompt and are never treated as instructions.",
        "Secrets: model and broker keys are read from macOS Keychain first, and are never stored in the repo. `agent/scripts/secret-scan.ts` runs in `npm run agent:test`.",
        "Strategy code runs in a separate sandboxed child process (10 s and 256 MB limits).",
    ], [
        "**No Content-Security-Policy header yet.** Adding a strict CSP is a cheap defence-in-depth win.",
        "No automated dependency vulnerability scan (for example `npm audit` in the gate). The exposure is reduced by zero server runtime dependencies and exact pins.",
        "No external penetration test. This is reasonable for a personal tool, but it should be noted.",
    ]),
    (10, "C", "Concurrency and parallelism", "core", "Locks · versions · idempotency", [
        "Server: `withLock` promise chains serialise writers to each JSON store. Writes are atomic (temp+rename). The cache is single-flight, so concurrent misses make one upstream call.",
        "Agent: SQLite single writer in WAL mode, a **per-thread lock with optimistic version (409 on conflict)**, idempotency keys, task leases, and **cost reservation before billable calls**, so parallel council calls cannot overspend.",
        "Council concurrency is capped at 2 specialist calls at a time. Cancellation aborts the whole call tree.",
        "Paper: Kestrel orders are serialised through a queue so they cannot race past the limits. Ticket approval is claimed under the orders lock. The book is rebuilt by replaying fills, so a duplicate event cannot double-count.",
        "Detail in Section 16 (Figure 12) and the worked example in 25.3.",
    ], []),
    (11, "C", "Performance and scalability", "scoped", "SWR cache · ETag · perf spec", [
        "Stale-while-revalidate cache with a persisted copy, so start-up and panel loads are served from cache.",
        "Static assets are hashed by esbuild and served with an ETag. API responses are `no-store`.",
        "Performance checks: `web/e2e/perf.spec.ts`. The canvas chart draws thousands of candles without a DOM per bar.",
        "Prompt-cache optimisation for agent cost and latency (FEAT-005, `agent/scripts/cache-probe.ts`).",
    ], [
        "Horizontal scaling, load balancing, CDN and autoscaling: not applicable (one user, one machine).",
        "No load, soak or spike tests. Not needed at this scale.",
    ]),
    (12, "C", "Reliability and fault tolerance", "partial", "Supervisor · health · stale data", [
        "Health endpoints: `/api/health` and `/v1/health`. `kestrel doctor` checks the agent setup.",
        "**Supervisor**: the server starts the agent, restarts it with backoff, and stops retrying after repeated crashes in 10 minutes, with a clear message (`lib/agentproc.ts`).",
        "Graceful degradation: when market data fails, the last good values are shown and flagged stale. When the agent is down, the terminal still works.",
        "Durability: atomic writes, corruption backup, a DB backup before migrations, and UNDO for book edits.",
        "launchd autostart keeps the server running and restarts it if it crashes (`install-autostart.sh`).",
    ], [
        "No formal SLO/RTO/RPO. The informal target is \"the terminal is up when the Mac is on\" and \"no data loss beyond the last write\".",
        "No automated backup restore test.",
    ]),
    (13, "C", "Testing and quality assurance", "core", "≈600 checks · E2E · a11y · evals", [
        "Unit and integration: 29 root test files (`test/`), 24 agent test files, and web unit tests, all on Node's built-in test runner.",
        "E2E: 48 Playwright specs with about 240 tests against an isolated server, the **fake market** and a fake agent. A separate real-agent council suite.",
        "Accessibility (axe), visual baselines, service-worker release checks, and performance checks.",
        "Agent evaluation: council cases (`agent/evals/council-cases.ts`, `evaluate-council.ts`), UI qualification and a secret scan.",
        "UAT: 30 scripted cases for human or computer-use testers (Section 20).",
        "Release gate: `npm run verify` runs typecheck, unit tests, the web build check and E2E.",
    ], [
        "No coverage or mutation-testing report is published.",
    ]),
    (14, "D", "SDLC and governance", "core", "AGENTS.md · FEAT specs · CHANGELOG", [
        "`AGENTS.md` defines conventions for human and AI contributors: no personal data in the repo, no LLM arithmetic, spec-first changes.",
        "Backlog and feature specs, feature branches merged into `main`, and a `CHANGELOG` with real commit references.",
        "Definition of done: the feature's acceptance criteria are met, `verify` is green, and docs are updated (Section 18.3).",
        "Technical-debt tools: `scripts/coupling-inventory.mjs`, `scripts/css-dead.mjs`, and the legacy-maths parity tests.",
    ], [
        "Reviews are by the owner and AI reviewers. There is no second human reviewer.",
    ]),
    (15, "D", "Infrastructure and cloud", "scoped", "Local Mac · loopback · launchd", [
        "Runs on the owner's computer, bound to `127.0.0.1`. `HOST=0.0.0.0` is an explicit opt-in for LAN access, and the Host check is relaxed only then.",
        "Environment isolation: separate data folders for real use, demo (`~/FinSightDemo`, port 8003) and tests (a temporary folder per run).",
        "Outbound only: market APIs, model providers and Alpaca paper. No inbound ports are exposed.",
    ], [
        "Cloud, containers, IaC, VPCs, gateways and data residency: not applicable. Nothing is hosted.",
    ]),
    (16, "D", "CI/CD and release engineering", "partial", "Local verify gate · lockfiles", [
        "Reproducible builds: exact versions and lockfiles, plus `npm run check:web` to confirm the built bundle matches the source.",
        "Release: merge to `main`, build, then restart the server (launchd). The agent rebuilds nothing at runtime.",
        "Rollback: `git revert` plus the DB `.bak-vN` copy made before a migration. Feature flags such as `KESTREL_COUNCIL` and approval modes allow progressive enablement.",
        "Smoke checks after start: health endpoints, `kestrel doctor`, and `startup.spec.ts`.",
    ], [
        "**No hosted CI.** The gate runs locally, so a GitHub Actions workflow that runs `npm run verify` on every push is the main gap.",
        "No release tags or versioned artifacts. `CHANGELOG` references commits instead.",
    ]),
    (17, "D", "Observability and monitoring", "scoped", "Audit log · traces · cost", [
        "Kestrel writes a structured JSONL **audit log** with 14-day retention, and keeps a **trace per turn** (model calls, tool calls, timings, tokens, cost) that is visible in the UI.",
        "Cost per answer and per day appears in the chat list. `kestrel logs` shows recent activity.",
        "The server shows live status (LIVE or stale) and the agent supervisor state with its last exit.",
    ], [
        "No metrics dashboard, distributed tracing or alerting. That fits one local user, and the price alerts are product features, not ops alerts.",
    ]),
    (18, "D", "Production operations and support", "scoped", "Runbook · doctor · demo", [
        "Runbook and troubleshooting: Section 21.3 and the guide's \"When something won't start\" scene.",
        "Patch management: dependencies are pinned and upgraded deliberately. Node 24+ is enforced by the launcher and the autostart script.",
        "Break-glass: delete `auth.json` to reset the PIN, and `npm run demo:reset` rebuilds the demo.",
    ], [
        "On-call, escalation, SLAs and maintenance windows: not applicable. The owner is the operator.",
    ]),
    (19, "E", "Cost engineering and FinOps", "core", "$0 infra · AI spend caps", [
        "Infrastructure cost is zero (local) and market data is free (keyless).",
        "**AI cost is the only variable cost.** Defaults are US$0.25 per reply and US$5 per day, and both can be edited (`/limits`).",
        "Costs are **reserved before** each billable call and settled afterwards, so parallel calls cannot overshoot the cap.",
        "Cost is shown per answer and per day. A cost tier per model guides model choice, and prompt caching lowers repeat cost.",
    ], []),
    (20, "E", "Privacy, legal and compliance", "scoped", "Local data · no telemetry", [
        "Data minimisation: holdings stay in a local 0600 folder outside the repo. There is no account and no telemetry.",
        "The data that leaves the machine is listed: questions and the tool results needed for them go to the chosen model provider, paper orders go to Alpaca, and symbol lookups go to public market APIs.",
        "`AGENTS.md` forbids committing personal data, keys or broker exports (`*.csv` is git-ignored).",
        "Licensing: the project is MIT, and dependencies are permissive.",
        "Not investment advice: the product and the council state this in the UI.",
    ], [
        "Singapore PDPA mainly governs organisations. An individual managing their own data in a personal capacity is outside its scope, and that would change if FinSight were offered to other users.",
        "Data-source terms of use (especially Yahoo) should be re-checked before any public distribution.",
    ]),
    (21, "E", "Documentation and knowledge", "core", "This document + guide", [
        "This master document, the interactive guide (`docs/guide/finsight-guide.html`), `README`, `START-HERE`, `DOCS.md`, the agent `SPEC.md` and `COUNCIL.md`, the architecture notes and feature specs.",
        "Diagrams in C4 style (Section 9), a data model, sequences, and a UAT catalogue.",
        "Docs live with the code and change in the same commit as the code they describe (docs-as-code).",
    ], [
        "Only one formal ADR and no OpenAPI file (see domains 2 and 7).",
    ]),
    (22, "E", "Product analytics and experiments", "na", "No telemetry by design", [
        "Intentionally none. Privacy is a product goal (G3).",
        "Quality is measured offline instead: council evaluation metrics (`council-metrics.ts`), cost and latency traces, and UAT results.",
    ], [
        "If FinSight ever has other users, add opt-in, privacy-preserving analytics.",
    ]),
    (23, "E", "Maintainability and evolution", "core", "Modules · plugins · TS strict", [
        "Separation of concerns: pure maths in `lib/` with parity tests, islands per feature, and one tool registry.",
        "**Extensibility through manifests**: brains, tools and skills are plugins (`agent/plugins`, `SKILL.md`), so a new model or playbook does not touch the core.",
        "TypeScript typecheck across server, web and agent. A frontend migration is tracked in `docs/frontend-migration`.",
        "Data portability: CSV export of holdings, the journal and the ledger, plus plain JSON data files.",
    ], [
        "Solo ownership is a bus-factor risk. This document and `AGENTS.md` exist to reduce it.",
    ]),
    (24, "E", "AI engineering and agentic systems", "core", "Tools · limits · evals · approvals", [
        "Model selection: pluggable brains with a cost tier and capabilities, and a default chosen by evaluation.",
        "Context engineering: the system prompt, the user's records and rules, the terminal context (symbol and range in view) and skills.",
        "**Tool calling over generation**: numbers come from deterministic tools, never from model arithmetic (an `AGENTS.md` rule). Answers carry an as-of time and sources.",
        "Structured output: the council contract is Zod-validated and figures in an assessment must cite evidence ids.",
        "Defences: untrusted-content labelling, an SSRF guard, read-only council tools, and an agent token that can do paper only.",
        "**Human approval**: record changes are proposals until the user confirms. Paper orders follow Ask mode (approve or reject) or Autonomous mode inside deterministic limits.",
        "Budgets: steps, seconds, searches, fetches, council calls, and dollars per turn and per day.",
        "Evaluation and observability: council evals, per-turn traces and cost.",
        "Fallback: switching models is one menu choice, and when the agent is down the terminal keeps working.",
    ], [
        "Evaluation sets are small and synthetic. They show that the pipeline works, not that the investment calls are good (stated in `CHANGELOG`).",
        "No RAG index over the user's documents. Uploads are read per turn instead.",
    ]),
]

STATUS_LABEL = {"core": "Implemented", "partial": "Partly done", "scoped": "Scoped down", "na": "Not applicable"}

# Section 25.4: priority matrix (MVP / Production / High scale) with where FinSight is today.
MATRIX = [
    ["Requirements and scope", "Required", "Required", "Required", "Done: PRD, stories, FEAT specs"],
    ["Architecture and tech stack", "Required", "Required", "Required", "Done: two-process modular monolith"],
    ["Frontend, backend, database", "Required", "Required", "Required", "Done"],
    ["Authentication and authorisation", "Required", "Required", "Required", "Done for one user: PIN, sessions, agent token"],
    ["Baseline security and data protection", "Required", "Required", "Required", "Mostly done; add a CSP and a dependency scan"],
    ["Concurrency correctness", "Required", "Required", "Required", "Done: locks, versions, idempotency, reservations"],
    ["Automated testing", "Basic", "Comprehensive", "Comprehensive", "Comprehensive: about 600 checks"],
    ["CI/CD and deployment", "Basic", "Mature", "Advanced", "Basic: local gate, no hosted CI"],
    ["Monitoring and alerting", "Basic", "Mature", "Advanced", "Basic: audit log and traces"],
    ["Backups and recovery", "Basic", "Tested", "Advanced", "Basic: migration and corruption backups, manual folder backup"],
    ["Performance optimisation", "Targeted", "Measured", "Extensive", "Targeted: caching, perf spec"],
    ["Load balancing and autoscaling", "Optional", "As needed", "Usually", "Not needed"],
    ["Distributed services", "Usually unnecessary", "As needed", "As needed", "Not needed: two local processes"],
    ["Disaster recovery", "Risk-based", "Planned", "Regularly tested", "Risk-based: a local copy of the data folder"],
    ["Cost management", "Basic", "Active", "Advanced", "Active for AI spend: caps and reservations"],
]

# Section 25.5: the document set the checklist recommends, mapped to where each lives in FinSight.
DOCSET = [
    ["`PRD.md`", "`docs/product/PRD.md`; Sections 1–7", "Present"],
    ["`NFR.md`", "Section 8 of this document", "Present (in this document)"],
    ["`ARCHITECTURE.md`", "`docs/architecture/SYSTEM.md`, `finsight-architecture.md`, `kestrel-architecture.md`; Section 9", "Present"],
    ["`ADR/`", "`agent/docs/ADR-THINKING-EFFORT.md`; other decisions inside feature specs", "Partial: one ADR, no ADR folder"],
    ["`TECH_STACK.md`", "Section 11; `package.json` files", "Present (in this document)"],
    ["`DATA_MODEL.md`", "Section 10.1; `agent/docs/SPEC.md`", "Present (in this document)"],
    ["`API_SPEC.yaml`", "Section 10.2; `agent/docs/SPEC.md`", "Gap: no machine-readable OpenAPI"],
    ["`SECURITY.md`", "Section 15; `agent/docs/SPEC.md` §10", "Present (in this document)"],
    ["`TEST_PLAN.md`", "Sections 19–20; `web/e2e/COVERAGE.md`", "Present"],
    ["`DEPLOYMENT.md`", "Section 21; `README.md`, `START-HERE.md`", "Present"],
    ["`OPERATIONS.md`", "Section 21.3; the guide's troubleshooting scene", "Present"],
    ["`ROADMAP.md`", "`docs/BACKLOG.md`; Section 23", "Present"],
    ["`AGENTS.md`", "`AGENTS.md` (repo root)", "Present"],
]

# Section 25.6: the five gates mapped to concrete FinSight checks.
GATES = [
    ("Design", "Feature spec in `docs/features` with scope, non-goals, data, interfaces and risks; architecture note updated"),
    ("Implementation", "`AGENTS.md` conventions; typecheck; unit tests next to the module; no LLM arithmetic"),
    ("Integration", "Playwright E2E with the fake market and fake or real agent; concurrency and failure cases (drops, 409s, stops)"),
    ("Release", "`npm run verify` + `npm run agent:test` (with the secret scan); visual baselines; `CHANGELOG` entry with commit refs"),
    ("Operations", "Health endpoints, `kestrel doctor`, supervisor restarts, audit log retention, data-folder backup"),
]


def blocks():
    """Document blocks for Section 25."""
    out = [
        ("h1", "25. Engineering review against 24 domains"),
        ("p", "This section checks FinSight against a complete software-engineering checklist of **24 domains** in five groups. The checklist draws on the AWS Well-Architected pillars and OWASP ASVS. For each domain it states whether the domain applies to a **single-user, local** application, what the code does today (with file evidence), and the honest gaps. A domain marked *not applicable* is a design decision with its reason, not an omission."),
        ("fig", "domains-map", "Figure 15 — The 24 engineering domains, coloured by FinSight's status"),
        ("kpis", [
            (str(sum(1 for d in DOMAINS if d[3] == "core")), "implemented"),
            (str(sum(1 for d in DOMAINS if d[3] == "partial")), "partly done"),
            (str(sum(1 for d in DOMAINS if d[3] == "scoped")), "scoped for local use"),
            (str(sum(1 for d in DOMAINS if d[3] == "na")), "not applicable"),
        ]),
        ("h2", "25.1 How the domains link together in FinSight"),
        ("p", "The domains are not separate features. They sit on the same layers. Product requirements drive the frontend, backend, data and integrations. Security, concurrency, testing and observability run across every layer, and the AI-agent domain spans all of them because Kestrel reads the book, calls tools and can place paper orders."),
        ("fig", "domains-layers", "Figure 16 — Engineering layers with cross-cutting concerns, mapped to FinSight components"),
        ("h2", "25.2 Domain-by-domain review"),
    ]
    for gid, gname in GROUPS:
        out.append(("h3", f"{gid}. {gname}"))
        for no, g, name, status, _ev, how, gaps in DOMAINS:
            if g != gid:
                continue
            out.append(("domain", no, name, STATUS_LABEL[status], status, how, gaps))
    out += [
        ("h2", "25.3 Worked example: two orders for the same paper position at once"),
        ("p", "The checklist's \"last item in stock\" example has a direct FinSight equivalent. The user clicks **Sell 8 AAPL** on the desk while Kestrel, in Autonomous mode, sends **Sell 8 AAPL** for the same position. Every domain has a job in getting this right:"),
        ("fig", "race-example", "Figure 17 — One race, many domains"),
        ("table", ["Domain", "What happens in FinSight"], [
            ["Frontend", "Both the desk and the Kestrel tab show 8 shares held. The ticket shows the estimate, not a promise."],
            ["Backend / API", "Both requests reach `POST /api/paper/orders`. The user's request is routed to `placeUserOrder` and the agent-token request to `placeKestrelOrder`."],
            ["Identity", "Only the agent token reaches the Kestrel path, and that path cannot change settings or limits."],
            ["Concurrency", "Kestrel's orders run **one at a time** through a queue (`kestrelQueue` in `lib/paper.ts`), so two Kestrel calls cannot both pass the orders-per-day and position checks before either is recorded. Order metadata is written under the orders lock."],
            ["Idempotency", "Approving a Kestrel ticket **claims it inside the orders lock** (pending → approving), so a double click or a second tab cannot send the same order twice. Every order carries a unique `client_order_id` (`fs-u-…` user, `fs-k-…` Kestrel) that ties each fill back to its origin."],
            ["Integration", "Alpaca is the source of truth. The second sell is rejected there (insufficient quantity), and the rejection is shown to whoever sent it."],
            ["Data", "The paper book is rebuilt by replaying fills from `trade_updates`, so it cannot record a sale that did not fill, and a duplicate event cannot double-count."],
            ["Reliability", "If the stream drops after a fill, the reconnect plus `/api/paper/sync` reconciles the book with Alpaca."],
            ["Observability", "Both orders keep their origin tag (user or Kestrel), so History shows who did what. The agent audit log has the turn that sent it."],
            ["Testing", "`PAPER.spec.ts` and `test/paper.test.ts` cover orders, limits, tickets and stream updates against the fake broker."],
        ]),
        ("h2", "25.4 Priorities: MVP, production, high scale"),
        ("p", "Not every domain needs enterprise depth. The matrix shows the expected level at each maturity stage and where FinSight stands. FinSight is a **production-grade personal tool**: it needs production-level correctness, security and testing, but not scale-out infrastructure."),
        ("table", ["Engineering domain", "MVP", "Production", "High scale", "FinSight today"], MATRIX),
        ("callout", "note", "Backups start on day one", "Backups matter as soon as valuable data is stored. FinSight backs up before migrations and on corruption, but the data folder itself should also be in the user's normal backup (Time Machine or an encrypted copy)."),
        ("h2", "25.5 Engineering documents"),
        ("p", "These are the recommended documents and where each concern lives in FinSight. Several are combined into this master document, which is fine at this stage as long as each concern has one clear home."),
        ("table", ["Recommended document", "Where it lives in FinSight", "Status"], DOCSET),
        ("h2", "25.6 The five engineering gates"),
        ("p", "Coding agents can write features quickly, but speed does not prove a change is correct, secure or ready to run. FinSight uses five gates, and each one maps to concrete checks:"),
        ("fig", "gates", "Figure 18 — Five engineering gates and the FinSight checks behind each"),
        ("h2", "25.7 Improvement backlog from this review"),
        ("table", ["Priority", "Item", "Domain", "Why"], [
            ["P1", "Add a hosted CI workflow that runs `npm run verify` and `npm run agent:test` on every push", "16 CI/CD", "The gate currently depends on someone remembering to run it"],
            ["P1", "Add a strict Content-Security-Policy header", "09 Security", "Defence in depth against injected script in rendered content"],
            ["P2", "Add a dependency audit (`npm audit --omit=dev` and the agent's dependencies) to the gate", "09 Security", "Agent and web dependencies are the main supply-chain surface"],
            ["P2", "Document and test a data-folder backup and restore", "06 / 12", "No restore drill exists"],
            ["P3", "Start `docs/adr/` with the key past decisions (local-only, zero-dependency server, JSON + SQLite, Alpaca paper only)", "02 / 21", "Makes the reasons findable for new contributors and agents"],
            ["P3", "Publish an OpenAPI description of `/api` and `/v1`", "07 / 21", "Contract tests and external tools"],
        ]),
        ("break",),
    ]
    return out
