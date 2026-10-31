"""SVG diagrams for the FinSight master document.

Each function returns a standalone SVG string. Colours follow the document
palette (violet = FinSight/Kestrel, amber = paper trading, teal = external).
"""
from html import escape

INK, INK2, MUTED, LINE = "#16141f", "#3b384b", "#6b6880", "#d9d5e6"
V, VW, VD = "#6d4fe0", "#efeafd", "#4b32b8"      # violet
A, AW = "#b7791f", "#fdf3e1"                       # amber (paper)
T, TW = "#0f766e", "#e3f5f2"                       # teal (external)
G, GW = "#15803d", "#e6f6ec"                       # green (data)
R, RW = "#c0362c", "#fdecea"                       # red (threat)
S, SW = "#475569", "#f1f3f7"                       # slate (neutral)
FONT = "Inter, 'Hanken Grotesk', 'Segoe UI', Helvetica, Arial, sans-serif"
MONO = "'JetBrains Mono', Menlo, monospace"
KIND = {"v": (V, VW), "a": (A, AW), "t": (T, TW), "g": (G, GW), "r": (R, RW), "s": (S, SW)}


def svg(w, h, body):
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {w} {h}" width="{w}" height="{h}" '
            f'font-family="{FONT}"><defs>'
            f'<marker id="ah" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill="{MUTED}"/></marker>'
            f'<marker id="ahv" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill="{V}"/></marker>'
            f'<marker id="aha" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill="{A}"/></marker>'
            f'</defs><rect width="{w}" height="{h}" fill="#ffffff"/>{body}</svg>')


def box(x, y, w, h, title, sub="", kind="v", fs=14, r=10, tag=None, mono_sub=False):
    c, bg = KIND[kind]
    out = f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="{r}" fill="{bg}" stroke="{c}" stroke-width="1.4"/>'
    lines = sub.split("\n") if sub else []
    total = fs + (len(lines) * 15 + 4 if lines else 0)
    ty = y + h / 2 - total / 2 + fs - 2
    out += f'<text x="{x + w / 2}" y="{ty}" text-anchor="middle" font-size="{fs}" font-weight="700" fill="{INK}">{escape(title)}</text>'
    for i, ln in enumerate(lines):
        fam = f' font-family="{MONO}"' if mono_sub else ""
        out += f'<text x="{x + w / 2}" y="{ty + 18 + i * 15}" text-anchor="middle" font-size="11.5" fill="{INK2}"{fam}>{escape(ln)}</text>'
    if tag:
        out += f'<rect x="{x + 8}" y="{y - 9}" width="{len(tag) * 7.4 + 16}" height="18" rx="9" fill="{c}"/><text x="{x + 15}" y="{y + 4}" font-size="10" font-weight="700" fill="#fff" letter-spacing=".6">{escape(tag)}</text>'
    return out


def group(x, y, w, h, label, kind="s", dash=True):
    c, bg = KIND[kind]
    d = ' stroke-dasharray="6 5"' if dash else ""
    return (f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="14" fill="{bg}" fill-opacity=".45" stroke="{c}" stroke-width="1.2"{d}/>'
            f'<text x="{x + 14}" y="{y + 20}" font-size="11" font-weight="700" fill="{c}" letter-spacing="1.2">{escape(label.upper())}</text>')


def arrow(x1, y1, x2, y2, label="", color=MUTED, marker="ah", lx=None, ly=None, dash=False, both=False, fs=11):
    d = ' stroke-dasharray="5 4"' if dash else ""
    ms = f' marker-start="url(#{marker})"' if both else ""
    out = f'<line x1="{x1}" y1="{y1}" x2="{x2}" y2="{y2}" stroke="{color}" stroke-width="1.5"{d} marker-end="url(#{marker})"{ms}/>'
    if label:
        lx = (x1 + x2) / 2 if lx is None else lx
        ly = (y1 + y2) / 2 - 6 if ly is None else ly
        tw = len(label) * fs * 0.56 + 10
        out += f'<rect x="{lx - tw / 2}" y="{ly - fs + 1}" width="{tw}" height="{fs + 6}" rx="4" fill="#fff" fill-opacity=".92"/>'
        out += f'<text x="{lx}" y="{ly + 2}" text-anchor="middle" font-size="{fs}" fill="{INK2}">{escape(label)}</text>'
    return out


def path(d, color=MUTED, marker="ah", dash=False):
    ds = ' stroke-dasharray="5 4"' if dash else ""
    return f'<path d="{d}" fill="none" stroke="{color}" stroke-width="1.5"{ds} marker-end="url(#{marker})"/>'


def text(x, y, s, size=12, color=INK2, weight=400, anchor="start", mono=False):
    fam = f' font-family="{MONO}"' if mono else ""
    return f'<text x="{x}" y="{y}" font-size="{size}" fill="{color}" font-weight="{weight}" text-anchor="{anchor}"{fam}>{escape(s)}</text>'


def legend(x, y, items):
    out = ""
    for i, (k, lab) in enumerate(items):
        c, bg = KIND[k]
        out += f'<rect x="{x + i * 150}" y="{y}" width="14" height="14" rx="3" fill="{bg}" stroke="{c}"/>' + text(x + i * 150 + 20, y + 11, lab, 11, MUTED)
    return out


# ------------------------------------------------------------------ diagrams

def capability_map():
    b = text(30, 34, "FinSight capability map", 17, INK, 700)
    cols = [
        ("FinSight Terminal", "v", ["Portfolio & multi-account book", "Stock vs FX P&L split", "Charts, indicators, strategies", "Performance: TWR · XIRR · vs index", "FX risk cockpit & VaR", "Dividends net of tax · ledger · undo", "Watchlist · alerts · Discover", "Macro: Fed, CPI, FRED, World Bank"]),
        ("Kestrel agent", "v", ["Chat panel: side · dock · full page", "≈38 tools, numbers from code", "Skills: pre-trade, review, earnings…", "SEC EDGAR + web research", "Files & screenshots", "Any model: DeepSeek · Claude · GPT", "Costs, limits, full trace", "MCP server for coding agents"]),
        ("Investment council", "v", ["3 specialists + 1 chair", "Assess → Challenge → Synthesize", "5 analytical lenses", "Evidence, against, uncertainty", "Cards / Chain of thought views", "Bounded budget, cancellable"]),
        ("Paper trading", "a", ["REAL / PAPER books", "Alpaca paper (fake money)", "Trade desk: chart + ticket", "Live fills over SSE", "Kestrel orders: ask or auto", "Deterministic limits gate"]),
    ]
    x = 30
    for name, k, items in cols:
        c, bg = KIND[k]
        h = 70 + len(items) * 30
        b += f'<rect x="{x}" y="58" width="250" height="{h}" rx="12" fill="{bg}" stroke="{c}" stroke-width="1.4"/>'
        b += f'<rect x="{x}" y="58" width="250" height="40" rx="12" fill="{c}"/><rect x="{x}" y="86" width="250" height="12" fill="{c}"/>'
        b += text(x + 125, 84, name, 15, "#fff", 700, "middle")
        for i, it in enumerate(items):
            b += f'<circle cx="{x + 20}" cy="{122 + i * 30}" r="3.5" fill="{c}"/>' + text(x + 32, 126 + i * 30, it, 12.5, INK2)
        x += 268
    b += f'<rect x="30" y="384" width="1054" height="44" rx="10" fill="{SW}" stroke="{S}"/>'
    b += text(557, 411, "Foundation: local-only Node 24 server · PIN lock · 0600 data folder · keyless public market data · demo mode · installable PWA", 12.5, INK2, 600, "middle")
    return svg(1114, 448, b)


def context_diagram():
    b = text(30, 34, "System context (C4 level 1)", 17, INK, 700)
    b += box(40, 180, 180, 90, "Investor (owner)", "single user · decides\nevery real trade", "s")
    b += group(300, 70, 470, 320, "User's computer · loopback only", "v")
    b += box(340, 120, 390, 100, "FinSight Terminal", "local web app + server :8000\nportfolio · market data · paper desk", "v", 16)
    b += box(340, 260, 390, 100, "Kestrel agent", "supervised service :8100\nresearch · council · paper orders", "v", 16)
    b += arrow(220, 225, 338, 170, "browser · PIN session", lx=270, ly=178)
    b += arrow(535, 220, 535, 258, "", V, "ahv", both=True)
    b += text(545, 244, "proxy + GET-only token", 11, INK2)
    ext = [(860, 60, "Market data", "Yahoo · FRED · World Bank\nForex Factory · Nasdaq IPOs", "t"),
           (860, 160, "Alpaca paper API", "orders · fills · trade_updates", "a"),
           (860, 260, "Model providers", "DeepSeek · Anthropic · OpenAI\nClaude Code CLI", "t"),
           (860, 360, "Research sources", "SEC EDGAR · Tavily · Brave\nany public URL (SSRF-guarded)", "t")]
    for x, y, t, s, k in ext:
        b += box(x, y, 230, 76, t, s, k)
    b += arrow(730, 160, 858, 98, "HTTPS, keyless", lx=790, ly=118)
    b += arrow(730, 185, 858, 198, "paper keys stay here", lx=794, ly=182)
    b += arrow(730, 300, 858, 298, "prompts + context", lx=794, ly=290)
    b += arrow(730, 330, 858, 395, "filings · search", lx=790, ly=372)
    b += box(40, 330, 180, 70, "Coding agents", "Claude Code · Codex\nCursor (via MCP)", "s")
    b += arrow(220, 365, 338, 330, "MCP stdio", lx=275, ly=338)
    return svg(1120, 460, b)


def container_diagram():
    b = text(30, 34, "Containers, processes and stores (C4 level 2)", 17, INK, 700)
    b += group(30, 56, 1060, 520, "macOS / Linux / Windows host", "s")
    b += box(60, 96, 300, 120, "Browser · Terminal UI", "React 19 SPA (public/app)\ncanvas chart.js · Kestrel island\nservice worker · TanStack Query", "v", 15)
    b += box(430, 96, 330, 120, "FinSight server :8000", "server.ts router · lib/* domain\nsecurity headers · Host check\nPIN sessions · agent proxy · SSE", "v", 15)
    b += box(830, 96, 230, 120, "Agent supervisor", "lib/agentproc.ts\nspawn · health probe\nrestart w/ backoff", "v", 14)
    b += box(430, 300, 330, 130, "Kestrel service :8100", "api/server.ts · Zod validation\nchat engine · tool loop · council\nbrain adapters · skills · sandbox", "v", 15)
    b += box(830, 300, 230, 130, "MCP server (stdio)", "node agent/src/cli.ts mcp\nsame tool registry\nfor external clients", "s", 14)
    b += box(60, 300, 300, 130, "Paper broker link", "lib/alpaca.ts · lib/paper.ts\npaperstream.ts (trade_updates)\nbook mirror · order gate", "a", 15)
    stores = [(60, "portfolio.json", "accounts · lots · txns"), (250, "paper/portfolio.json", "Alpaca mirror"), (440, "auth.json · book.json", "scrypt PIN · mode"),
              (630, "agent.db (SQLite WAL)", "threads · traces · cost"), (850, "Keychain / 0600 files", "API & paper keys")]
    for x, t, s in stores:
        b += box(x, 480, 180 if x != 850 else 210, 64, t, s, "g", 12.5, mono_sub=False)
    b += text(60, 470, "FINSIGHT_DATA_DIR  (~/FinSightData, outside the repo, files 0600)", 11, G, 700)
    b += arrow(360, 156, 428, 156, "HTTP + SSE", lx=394, ly=146)
    b += arrow(760, 156, 828, 156)
    b += arrow(945, 216, 760, 318, "spawns", lx=880, ly=262, dash=True)
    b += arrow(560, 216, 560, 298, "proxy · secret", V, "ahv", lx=610, ly=262)
    b += path("M640,298 L640,216", V, "ahv", dash=True)
    b += text(648, 236, "GET-only token", 11, V)
    b += arrow(430, 260, 362, 330, "", A, "aha")
    b += text(372, 280, "orders", 11, A)
    b += arrow(210, 430, 210, 478, "")
    b += arrow(595, 216, 150, 478, "", G, dash=True)
    return svg(1120, 600, b)


def server_components():
    b = text(30, 34, "FinSight server modules (lib/)", 17, INK, 700)
    b += box(420, 60, 280, 64, "server.ts", "routes · headers · session gate", "v", 15)
    groups = [
        (30, "Access", "v", [("auth.ts", "scrypt PIN, sessions, throttle"), ("agentlink.ts", "token + proxy secret"), ("agentproc.ts", "agent supervisor"), ("book.ts", "REAL / PAPER mode")]),
        (300, "Portfolio domain", "v", [("store.ts", "load · migrate · withLock"), ("portfolio.ts", "P&L, stock/FX split"), ("ledger.ts", "trades, realized gains"), ("transfers.ts", "lots between accounts"), ("csv.ts · trade-import.ts", "CSV / IBKR import")]),
        (570, "Analytics", "v", [("performance.ts", "replay, TWR, XIRR"), ("returns.ts", "pure return math"), ("dividends.ts", "WHT, forward income"), ("alertmath.ts", "alert rules"), ("journal.ts · charts.ts", "notes, chart data")]),
        (840, "Market & paper", "a", [("market.ts", "Yahoo, 429 backoff"), ("macro.ts · discover.ts", "FRED, WB, calendar, movers"), ("cache.ts", "SWR + single-flight"), ("alpaca.ts · paper.ts", "orders, gate, mirror"), ("paperstream.ts", "trade_updates → SSE")]),
    ]
    for x, name, k, items in groups:
        c, _ = KIND[k]
        b += group(x, 160, 250, 60 + len(items) * 62, name, k, dash=False)
        for i, (t, s) in enumerate(items):
            b += box(x + 15, 192 + i * 62, 220, 50, t, s, k, 12.5, r=8)
        b += arrow(560, 124, x + 125, 158, "")
    return svg(1120, 520, b)


def agent_components():
    b = text(30, 34, "Kestrel agent internals (agent/src)", 17, INK, 700)
    b += box(40, 70, 220, 70, "api/", "HTTP · Zod · idempotency\nsecret + no-Origin gate", "v", 14)
    b += box(320, 70, 260, 70, "chat/ engine", "turn loop · limits · SSE bus\ncontext pack · council", "v", 15)
    b += box(640, 70, 200, 70, "brains/", "DeepSeek · Anthropic\nOpenAI-compat · CLI", "v", 14)
    b += box(900, 70, 190, 70, "Providers", "model APIs", "t", 14)
    b += box(320, 200, 260, 70, "tools/ registry", "facts · strategies · web\nrecords · paper · ui", "v", 15)
    b += box(40, 200, 220, 70, "skills.ts", "SKILL.md playbooks\n/pre-trade-check …", "s", 14)
    b += box(640, 200, 200, 70, "sandbox/", "strategy engines in\na child process", "s", 14)
    b += box(900, 200, 190, 70, "FinSight :8000", "GET-only token", "v", 14)
    b += box(40, 330, 220, 70, "store/ agent.db", "SQLite WAL, 1 writer\nthreads · events · cost", "g", 14)
    b += box(320, 330, 260, 70, "obs/ + log.ts", "traces · JSONL logs\nredaction · cost ledger", "g", 14)
    b += box(640, 330, 200, 70, "secrets.ts", "Keychain → env fallback", "g", 14)
    b += box(900, 330, 190, 70, "mcp/", "stdio MCP server", "s", 14)
    b += arrow(260, 105, 318, 105)
    b += arrow(580, 105, 638, 105)
    b += arrow(840, 105, 898, 105)
    b += arrow(450, 140, 450, 198, "tool calls", lx=488, ly=172)
    b += arrow(318, 235, 262, 235)
    b += arrow(580, 235, 638, 235)
    b += arrow(580, 222, 898, 222, "", V, "ahv")
    b += arrow(380, 140, 160, 328, "", dash=True)
    b += arrow(450, 270, 450, 328)
    b += arrow(995, 330, 995, 272, "", dash=True)
    return svg(1120, 420, b)


def seq(title, actors, msgs, w=1120, colw=None, kinds=None):
    n = len(actors)
    colw = colw or (w - 80) / n
    xs = [60 + colw * i + colw / 2 - 20 for i in range(n)]
    h = 120 + len(msgs) * 38 + 30
    b = text(30, 34, title, 17, INK, 700)
    for i, a in enumerate(actors):
        k = (kinds or ["v"] * n)[i]
        c, bg = KIND[k]
        b += f'<rect x="{xs[i] - 78}" y="54" width="156" height="40" rx="9" fill="{bg}" stroke="{c}" stroke-width="1.4"/>'
        b += text(xs[i], 79, a, 12.5, INK, 700, "middle")
        b += f'<line x1="{xs[i]}" y1="94" x2="{xs[i]}" y2="{h - 16}" stroke="{LINE}" stroke-width="1.5" stroke-dasharray="4 4"/>'
    for j, (f, t, label, *opt) in enumerate(msgs):
        y = 124 + j * 38
        style = opt[0] if opt else ""
        color = A if "a" in style else (V if "v" in style else MUTED)
        mk = "aha" if "a" in style else ("ahv" if "v" in style else "ah")
        if f == t:
            b += path(f"M{xs[f]},{y - 8} h34 v16 h-32", color, mk)
            b += text(xs[f] + 42, y + 4, label, 11.5, INK2)
        else:
            b += arrow(xs[f], y, xs[t] + (-4 if t > f else 4), y, "", color, mk, dash="d" in style)
            b += text((xs[f] + xs[t]) / 2, y - 6, label, 11.5, INK2, 500, "middle")
        b += text(18, y + 4, f"{j + 1:02d}", 10, MUTED, 700, mono=True)
    return svg(w, h, b)


def kestrel_turn_seq():
    return seq("Sequence · one Kestrel research turn",
               ["Browser panel", "FinSight :8000", "Kestrel :8100", "Model provider", "Tools → FinSight"],
               [(0, 1, "POST /api/agent/…/messages (PIN cookie)"), (1, 2, "forward + X-Agent-Secret", "v"),
                (2, 2, "validate (Zod), idempotency, thread lock"), (2, 2, "build context pack · reserve cost"),
                (2, 3, "prompt + tool schemas", "v"), (3, 2, "tool call: get_exposures", "d"),
                (2, 4, "GET /api/... with GET-only token", "v"), (4, 2, "facts + asOf", "d"),
                (2, 3, "tool result (untrusted data wrapped)", "v"), (3, 2, "streamed answer tokens", "d"),
                (2, 1, "SSE events: tool · text · turn.finish", "d"), (1, 0, "SSE passthrough → UI renders", "d"),
                (2, 2, "persist trace, usage, reconcile cost")],
               kinds=["v", "v", "v", "t", "g"])


def paper_order_seq():
    return seq("Sequence · paper order (user ticket or Kestrel ticket)",
               ["User / Kestrel", "Paper gate (server)", "Alpaca paper", "trade_updates", "Browser desk"],
               [(0, 1, "POST /api/paper/orders  {origin}", "a"), (1, 1, "origin = kestrel? → check approval mode"),
                (1, 1, "limits: max US$ · per day · max % · allowlist"), (1, 4, "ask mode → pending ticket (Approve/Reject)", "a"),
                (4, 1, "POST /api/paper/tickets/decide", "a"), (1, 2, "submit order (paper base URL only)", "a"),
                (2, 3, "fill event", "d"), (3, 1, "stream → resync book mirror", "d"),
                (1, 4, "SSE /api/paper/stream: order + fill", "d"), (4, 4, "positions · P&L · chart markers update")],
               kinds=["a", "a", "a", "a", "v"])


def council_flow():
    b = text(30, 34, "Investment council pipeline", 17, INK, 700)
    b += box(420, 56, 280, 64, "Question + lens", "explicit scope · subject routing", "a", 15)
    b += box(420, 150, 280, 56, "Evidence planning", "verified instrument + quote first", "s", 13.5)
    specs = [(80, "Business & Growth", "quotes · history · SEC"), (420, "Macro & Valuation", "quotes · history · SEC · macro"), (760, "Portfolio Risk", "exposures · positions · cash · policy")]
    for x, t, s in specs:
        b += box(x, 250, 280, 70, t, s, "v", 15, tag="ASSESS")
        b += arrow(560, 206, x + 140, 248)
        b += box(x, 360, 280, 56, "Challenge round", "sees all assessments + evidence", "s", 13.5, tag="CHALLENGE")
        b += arrow(x + 140, 320, x + 140, 358)
        b += arrow(x + 140, 416, 560, 458)
    b += arrow(560, 120, 560, 148)
    b += box(380, 460, 360, 76, "Kestrel Chair", "agreed · still needed · what changes the view", "v", 16, tag="SYNTHESIZE")
    b += text(30, 576, "Budget: API brains only · concurrency 2 · ≤4 tool requests + 1 follow-up per analyst · ¼ of turn ceiling held for synthesis · cancellable tree", 12, INK2)
    b += text(30, 596, "Output: verdict, evidence / against counts, uncertainty, invalidation per specialist; figures flagged if not tied to a tool result", 12, INK2)
    return svg(1120, 616, b)


def user_flows():
    b = text(30, 34, "Core user flows", 17, INK, 700)
    rows = [
        ("Onboard", "s", ["Launch\nnpm run demo / node server.ts", "Opening Bell\npick REAL or PAPER", "Enter PIN\nUNLOCK", "Operator card\nname · base currency", "Add holdings\nCSV · manual · empty"]),
        ("Daily check", "v", ["Summary cards\nnet worth · day P&L", "Positions\nclick a row", "Security detail\nchart · strategies", "FX Risk\nwhat-if · VaR", "Discover · Calendar\nmovers · Fed · CPI"]),
        ("Ask Kestrel", "v", ["⌘/ open panel", "Briefing tile\nor type / skill", "Tools run\nlog streams", "Answer\nasOf · sources · cost", "Follow-up or\nconfirm proposal"]),
        ("Council", "v", ["⚖ Council on", "Choose lens", "Ask decision\nquestion", "Watch Cards /\nChain of thought", "Read chair\nyou decide"]),
        ("Paper trade", "a", ["Switch PAPER", "Connect Alpaca\npaper keys (PK…)", "Ticket: side · type\nsize · TIF", "Buy / Sell\n(or Approve Kestrel)", "Fill streams in\nbook + chart update"]),
    ]
    for r, (name, k, steps) in enumerate(rows):
        y = 60 + r * 108
        c, bg = KIND[k]
        b += f'<rect x="30" y="{y + 12}" width="120" height="66" rx="10" fill="{c}"/>' + text(90, y + 50, name, 14, "#fff", 700, "middle")
        for i, s in enumerate(steps):
            x = 175 + i * 188
            b += box(x, y + 8, 168, 74, s.split("\n")[0], "\n".join(s.split("\n")[1:]), k, 13, r=9)
            if i:
                b += arrow(x - 20, y + 45, x - 2, y + 45)
    return svg(1130, 610, b)


def trust_boundaries():
    b = text(30, 34, "Trust boundaries and controls", 17, INK, 700)
    b += group(30, 60, 300, 400, "Untrusted zone", "r")
    for i, (t, s) in enumerate([("Other local apps / web pages", "may try to call :8000/:8100"), ("Web pages & news", "may contain prompt injection"), ("Uploaded files", "PDF / DOCX / CSV / images"), ("Strategy plugins", "third-party code")]):
        b += box(50, 96 + i * 88, 260, 70, t, s, "r", 13.5)
    b += group(380, 60, 330, 400, "FinSight trust boundary", "v")
    for i, (t, s) in enumerate([("Loopback bind + Host allowlist", "anti DNS-rebinding"), ("PIN session (scrypt, throttle)", "HttpOnly · SameSite=Strict"), ("Same-origin / JSON checks", "CSRF defence"), ("Security headers", "X-Frame-Options DENY · nosniff")]):
        b += box(400, 96 + i * 88, 290, 70, t, s, "v", 13.5)
    b += group(760, 60, 330, 400, "Agent trust boundary", "v")
    for i, (t, s) in enumerate([("Proxy secret, no-Origin gate", "only FinSight may call :8100"), ("GET-only token + allowlist", "agent cannot write the real book"), ("Untrusted-data wrapping", "SSRF netguard · sanitised markdown"), ("Spend caps · step limits", "per turn and per day")]):
        b += box(780, 96 + i * 88, 290, 70, t, s, "v", 13.5)
    for i in range(4):
        b += arrow(312, 131 + i * 88, 398, 131 + i * 88, "", R)
        b += arrow(692, 131 + i * 88, 778, 131 + i * 88, "", V, "ahv")
    b += box(30, 480, 1060, 56, "Secrets: Keychain (finsight-agent) or 0600 files in the data folder · never in the repo, prompts or logs · secret scan in CI", "", "g", 13)
    return svg(1120, 556, b)


def concurrency_map():
    b = text(30, 34, "Concurrency and consistency controls", 17, INK, 700)
    items = [
        ("v", "Portfolio writes", "withLock() promise chain serialises\nread-modify-write · temp file + rename"),
        ("v", "Undo", "25-step snapshot stack,\nsame lock as the write"),
        ("g", "Market cache", "single-flight per key · stale-while-\nrevalidate · 429 backoff · persisted"),
        ("g", "agent.db", "one writer connection · WAL readers\nbusy_timeout · migrations w/ backup"),
        ("v", "Threads", "per-thread turn lock · optimistic\nversion → 409 on stale write"),
        ("v", "Requests", "idempotency keys on messages\nand task creation"),
        ("s", "Tasks", "atomic claim UPDATE…RETURNING\n60 s lease · 15 s heartbeat · ≤3 tries"),
        ("s", "Cost caps", "reserve before each billable call,\nreconcile after · daily ledger"),
        ("v", "Council", "concurrency 2 · no other reply while\nrunning · cancel aborts whole tree"),
        ("a", "Paper book", "Alpaca = source of truth · resync on\nfill · manual edits refused"),
        ("a", "Order gate", "deterministic limits before submit\norigin-tagged · settings PIN-only"),
        ("s", "Streams", "SSE with event ids + replay ·\nreconnect resumes, no duplicates"),
    ]
    for i, (k, t, s) in enumerate(items):
        x, y = 30 + (i % 4) * 268, 60 + (i // 4) * 120
        b += box(x, y, 252, 100, t, s, k, 14.5)
    return svg(1120, 430, b)


def sdlc_loop():
    b = text(30, 34, "Delivery lifecycle (docs-as-code)", 17, INK, 700)
    steps = [("Idea", "IDEA-xxx in BACKLOG\nicebox", "s"), ("Spec", "FEAT-xxx.md\nintent · decisions · AC", "v"), ("Select", "user selects; task ID\nharness queue", "v"),
             ("Design", "agent SPEC / ADR\nbefore code", "v"), ("Build", "feature branch\nTS strict · small PRs", "v"), ("Verify", "npm run verify\nagent:test · e2e", "g"),
             ("Review & merge", "source review\nmerge to main", "g"), ("Release", "CHANGELOG with hashes\nimplemented ≠ deployed", "a")]
    import math
    cx, cy, rad = 560, 330, 230
    for i, (t, s, k) in enumerate(steps):
        ang = -math.pi / 2 + i * 2 * math.pi / len(steps)
        x, y = cx + rad * 1.65 * math.cos(ang) - 100, cy + rad * math.sin(ang) - 40
        b += box(x, y, 200, 80, t, s, k, 15)
    for i in range(len(steps)):
        a1 = -math.pi / 2 + (i + .5) * 2 * math.pi / len(steps)
        b += f'<circle cx="{cx + rad * 1.65 * math.cos(a1)}" cy="{cy + rad * math.sin(a1)}" r="4" fill="{V}"/>'
    b += f'<ellipse cx="{cx}" cy="{cy}" rx="{rad * 1.65}" ry="{rad}" fill="none" stroke="{LINE}" stroke-width="2" stroke-dasharray="6 6"/>'
    b += box(cx - 150, cy - 46, 300, 92, "Quality gates", "typecheck · unit · agent · secret scan\nbuild check · Playwright · a11y · visual", "g", 15)
    return svg(1120, 620, b)


def test_pyramid():
    b = text(30, 34, "Test strategy", 17, INK, 700)
    layers = [("UAT · computer-use scripts", "a", 300, "Codex / human walkthrough of the UAT catalogue"),
              ("Real-backend checks", "v", 420, "council against a live model · live fixtures"),
              ("Browser E2E · Playwright (~262)", "v", 560, "fake market · fake Alpaca · fake agent · a11y · visual · perf · SW"),
              ("Agent tests (~130) + secret scan", "g", 700, "tool loop · limits · council contract · netguard"),
              ("Unit tests (~216) · node:test", "g", 840, "portfolio math · returns · CSV · cache · auth · paper gate")]
    for i, (t, k, w, s) in enumerate(layers):
        c, bg = KIND[k]
        y = 60 + i * 74
        x = 560 - w / 2
        b += f'<path d="M{x},{y + 64} L{x + 26},{y} L{x + w - 26},{y} L{x + w},{y + 64} Z" fill="{bg}" stroke="{c}" stroke-width="1.4"/>'
        b += text(560, y + 28, t, 14, INK, 700, "middle") + text(560, y + 48, s, 11.5, INK2, 400, "middle")
    b += text(30, 450, "Counts are from the 2026-10-29 verification record; re-run `npm run verify` for current numbers.", 11.5, MUTED)
    return svg(1120, 466, b)


def data_model():
    b = text(30, 34, "Data model (simplified)", 17, INK, 700)

    def ent(x, y, name, fields, k="g", w=230):
        c, bg = KIND[k]
        h = 34 + len(fields) * 20
        o = f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="9" fill="#fff" stroke="{c}" stroke-width="1.4"/>'
        o += f'<rect x="{x}" y="{y}" width="{w}" height="28" rx="9" fill="{c}"/><rect x="{x}" y="{y + 18}" width="{w}" height="10" fill="{c}"/>'
        o += text(x + 12, y + 19, name, 12.5, "#fff", 700, mono=True)
        for i, f in enumerate(fields):
            o += text(x + 12, y + 48 + i * 20, f, 11.5, INK2, mono=True)
        return o
    b += ent(30, 60, "portfolio.json", ["base · profile", "accounts[]", "watchlist[] · alerts[]", "withholding{}"])
    b += ent(320, 60, "account", ["id · name · type", "positions[]", "transactions[]", "dividends[] · cash{}"])
    b += ent(610, 60, "position", ["symbol · currency", "lots[] { q, px, fxUsd, t }", "sector · class"])
    b += ent(880, 60, "transaction", ["t · side · symbol", "qty · px · fx", "realized · source"], w=210)
    b += ent(30, 270, "paper/portfolio.json", ["account \"Alpaca Paper\" (USD)", "replayed from fills"], "a")
    b += ent(320, 270, "paper order", ["id · symbol · side · type", "qty | notional · limit", "tif · status", "origin: user | kestrel"], "a")
    b += ent(610, 270, "kestrel ticket", ["id · order draft · note", "status: pending|approved|", "  rejected|refused(reason)", "thread id"], "a")
    b += ent(880, 270, "paper settings", ["approval: ask | auto", "maxOrderUsd · perDay", "maxPositionPct", "allowlist[]"], "a", 210)
    b += ent(30, 440, "agent.db · threads", ["id · title · version", "defaultBrain · pinned"], "v")
    b += ent(320, 440, "messages · events", ["thread · role · blocks[]", "event id (SSE replay)"], "v")
    b += ent(610, 440, "turns · traces · cost", ["usage · ms · tool calls", "reservations · ledger"], "v")
    b += ent(880, 440, "proposals · FTS", ["record updates (pending)", "full-text search"], "v", 210)
    b += arrow(260, 100, 318, 100, "1..n")
    b += arrow(550, 100, 608, 100, "1..n")
    b += arrow(550, 140, 878, 120, "1..n", lx=760, ly=150)
    b += arrow(550, 330, 608, 330, "0..1")
    return svg(1120, 540, b)


# ------------------------------------------------------------------ section 25

def domains_map():
    from domains import DOMAINS, GROUPS
    st = {"core": ("g", "Implemented"), "partial": ("a", "Partly done"), "scoped": ("t", "Scoped for local use"), "na": ("s", "Not applicable")}
    b = text(30, 34, "24 engineering domains · FinSight status", 17, INK, 700)
    y = 58
    for gid, gname in GROUPS:
        ds = [d for d in DOMAINS if d[1] == gid]
        b += text(30, y + 14, f"{gid} · {gname.upper()}", 11, MUTED, 700)
        y += 22
        for i, d in enumerate(ds):
            col, row = i % 4, i // 4
            x, yy = 30 + col * 268, y + row * 64
            k = st[d[3]][0]; c, bg = KIND[k]
            b += f'<rect x="{x}" y="{yy}" width="256" height="54" rx="9" fill="{bg}" stroke="{c}" stroke-width="1.3"/>'
            b += f'<rect x="{x}" y="{yy}" width="6" height="54" rx="3" fill="{c}"/>'
            b += text(x + 16, yy + 21, f"{d[0]:02d}  {d[2]}", 12.5, INK, 700)
            b += text(x + 16, yy + 40, d[4], 11, INK2)
        y += ((len(ds) + 3) // 4) * 64 + 10
    lx = 30
    for k, lab in [("g", "Implemented"), ("a", "Partly done"), ("t", "Scoped for local use"), ("s", "Not applicable")]:
        c, bg = KIND[k]
        b += f'<rect x="{lx}" y="{y + 6}" width="14" height="14" rx="3" fill="{bg}" stroke="{c}"/>' + text(lx + 20, y + 17, lab, 11.5, MUTED)
        lx += 190
    return svg(1104, y + 34, b)


def domains_layers():
    b = text(30, 34, "Engineering layers in FinSight (cross-cutting concerns on the right)", 17, INK, 700)
    layers = [
        ("Product & requirements", "01", "PRD · stories · FEAT specs · UAT", "s"),
        ("Frontend & UX", "04", "React SPA · panels · desk · Kestrel panel · PWA · a11y", "v"),
        ("API & integration", "07", "/api REST · /v1 agent · SSE replay · MCP stdio", "v"),
        ("Backend logic", "05", "server.ts routes · lib/ maths · paper gate · supervisor", "v"),
        ("Agent (AI) layer", "24", "chat engine · brains · ≈38 tools · skills · council", "v"),
        ("Data", "06", "portfolio JSON (0600, atomic) · agent.db SQLite WAL", "g"),
        ("External services", "03 · 15", "Yahoo · FRED · World Bank · SEC · model APIs · Alpaca paper", "t"),
    ]
    y = 60
    for name, no, sub, k in layers:
        c, bg = KIND[k]
        b += f'<rect x="30" y="{y}" width="700" height="52" rx="10" fill="{bg}" stroke="{c}" stroke-width="1.3"/>'
        b += text(48, y + 22, name, 14, INK, 700) + text(48, y + 40, sub, 11.5, INK2)
        b += f'<rect x="652" y="{y + 15}" width="64" height="22" rx="11" fill="{c}"/>' + text(684, y + 30, no, 11, "#fff", 700, "middle")
        y += 60
    bands = [("Security · IAM", "08 · 09", "r"), ("Concurrency", "10", "a"), ("Reliability · perf", "11 · 12", "t"),
             ("Testing · QA", "13", "g"), ("SDLC · CI/CD · docs", "14 · 16 · 21", "s"), ("Observability · ops · cost", "17 · 18 · 19", "s"), ("Privacy · maintainability", "20 · 22 · 23", "s")]
    x = 752
    for name, no, k in bands:
        c, bg = KIND[k]
        b += f'<rect x="{x}" y="60" width="44" height="{y - 68}" rx="10" fill="{bg}" stroke="{c}" stroke-width="1.3"/>'
        cx, cy = x + 22, 60 + (y - 68) / 2
        b += f'<text x="{cx}" y="{cy}" transform="rotate(-90 {cx} {cy})" text-anchor="middle" font-size="12" font-weight="700" fill="{INK}">{escape(name)}</text>'
        b += f'<text x="{cx}" y="{y - 14}" text-anchor="middle" font-size="9.5" font-weight="700" fill="{c}">{escape(no.split(" · ")[0])}</text>'
        x += 50
    return svg(1112, y + 6, b)


def race_example():
    b = text(30, 34, "Race: the user and Kestrel both sell the same 8 AAPL", 17, INK, 700)
    b += box(30, 70, 200, 70, "User · trade desk", "Sell 8 AAPL", "s", tag="FRONTEND")
    b += box(30, 200, 200, 70, "Kestrel · Autonomous", "Sell 8 AAPL", "v", tag="AGENT")
    b += box(300, 70, 230, 70, "placeUserOrder", "PIN session cookie", "v", tag="IAM", mono_sub=False)
    b += box(300, 200, 230, 70, "placeKestrelOrder", "agent token → queue → limits", "v", tag="CONCURRENCY")
    b += box(600, 130, 220, 80, "submit()", "orders lock · client_order_id\nfs-u-… / fs-k-…", "a", tag="IDEMPOTENCY")
    b += box(890, 130, 190, 80, "Alpaca paper", "source of truth\n2nd sell rejected", "t", tag="INTEGRATION")
    b += box(600, 290, 220, 70, "Book replay", "fills → paper/portfolio.json", "g", tag="DATA")
    b += box(890, 290, 190, 70, "SSE + History", "origin tags · audit log", "s", tag="OBSERVABILITY")
    b += arrow(230, 105, 298, 105) + arrow(230, 235, 298, 235)
    b += arrow(530, 105, 598, 150) + arrow(530, 235, 598, 190)
    b += arrow(820, 170, 888, 170, "order")
    b += path("M985 210 L985 250 L710 250 L710 288", G, "ah")
    b += text(850, 245, "trade_updates", 11, INK2, 400, "middle")
    b += arrow(820, 325, 888, 325)
    b += f'<rect x="30" y="384" width="1050" height="40" rx="10" fill="{SW}" stroke="{S}"/>'
    b += text(555, 409, "TESTING: PAPER.spec.ts and test/paper.test.ts drive orders, limits, tickets and the stream against the fake broker", 12, INK2, 600, "middle")
    return svg(1110, 444, b)


def gates():
    from domains import GATES
    b = text(30, 34, "Five engineering gates", 17, INK, 700)
    kinds = ["v", "v", "a", "g", "t"]
    for i, (name, checks) in enumerate(GATES):
        x = 30 + i * 214
        c, bg = KIND[kinds[i]]
        b += f'<rect x="{x}" y="60" width="200" height="190" rx="12" fill="{bg}" stroke="{c}" stroke-width="1.4"/>'
        b += f'<circle cx="{x + 30}" cy="90" r="16" fill="{c}"/>' + text(x + 30, 95, str(i + 1), 14, "#fff", 700, "middle")
        b += text(x + 54, 89, name, 14, INK, 700) + text(x + 54, 104, "GATE", 9.5, c, 700)
        words, line, ly = checks.replace("`", "").split(" "), "", 130
        for w in words:
            if len(line) + len(w) > 28:
                b += text(x + 16, ly, line.strip(), 11.5, INK2); ly += 17; line = ""
            line += w + " "
        if line.strip():
            b += text(x + 16, ly, line.strip(), 11.5, INK2)
        if i < 4:
            b += arrow(x + 200, 155, x + 213, 155)
    return svg(1100, 270, b)


ALL = {
    "capability-map": capability_map, "context": context_diagram, "containers": container_diagram,
    "server-components": server_components, "agent-components": agent_components, "seq-kestrel": kestrel_turn_seq,
    "seq-paper": paper_order_seq, "council": council_flow, "user-flows": user_flows, "trust": trust_boundaries,
    "concurrency": concurrency_map, "sdlc": sdlc_loop, "tests": test_pyramid, "data-model": data_model,
    "domains-map": domains_map, "domains-layers": domains_layers, "race-example": race_example, "gates": gates,
}
