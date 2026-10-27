# Kestrel: the FinSight agent

Kestrel is a model-agnostic investment research agent that lives in a collapsible chat panel inside FinSight. It answers from your live FinSight data (holdings, cash, events, journal), your strategy library, your policy records and the web, citing sources and data times. It **cannot** trade, move money or change your data.

- Spec: `docs/SPEC.md`. Part of FinSight: FinSight starts and supervises the agent automatically.
- Models (plugins in `plugins/brains/`): DeepSeek Flash (default), DeepSeek V4 Pro, Claude Haiku 5.5, Claude Code. Pick one in the panel's model selector.

## Run it

Kestrel is part of FinSight: **FinSight starts it, restarts it if it crashes, and stops it when FinSight stops.** One-time setup, in the `finsight` folder:

```bash
npm run agent:install
```

Then start FinSight as usual. For your personal setup, double-click `~/FinSightData/start-finsight-personal.command`. Press **↗ KESTREL** (or ⌘/).

- **Agent output:** `~/FinSightData/agent/agent.log`.
- **Status:** `GET /api/agent-status` (the panel shows it when Kestrel is offline).
- **Turn it off:** `AGENT_AUTOSTART=0`.
- **Records:** your policy, profile and decision-log markdown is read from `recordsDir` in `~/FinSightData/agent/config.json`. It is never stored in the repo.

## Keys (macOS Keychain, never in files)

The agent reads keys from the Keychain (service `finsight-agent`), then from environment variables. DeepSeek already works from your `DEEPSEEK_API_KEY` environment variable. To store keys in the Keychain instead, run each command and paste the key when prompted:

```bash
security add-generic-password -U -s finsight-agent -a DEEPSEEK_API_KEY -w
security add-generic-password -U -s finsight-agent -a TAVILY_API_KEY -w
security add-generic-password -U -s finsight-agent -a ANTHROPIC_API_KEY -w
```

- **Web search** needs `TAVILY_API_KEY` (free tier at tavily.com) or `BRAVE_API_KEY`. Without one, `web_search` reports "not configured"; SEC EDGAR, FinSight news and FRED still work.
- **Haiku** needs `ANTHROPIC_API_KEY`.
- **Claude Code** uses your `claude` CLI login. If it says the OAuth session expired, run `claude` in a terminal and log in again.

## Search providers and GPT models

Search and model choice are independent. Defaults stay Tavily search and local page reading. To opt into DeepSeek, merge these fields into your private agent config and restart FinSight:

```json
{ "searchProvider": "deepseek", "fetchProvider": "deepseek" }
```

Both use `DEEPSEEK_API_KEY` through the existing secret store. `fetchProvider: "local"` keeps the free local reader while using DeepSeek search. `searchProvider: "none"` disables the shared search tool. DeepSeek queries, including domain/date filters, must fit 128 Unicode characters; longer queries return a validation error. Search/fetch caches are separate per provider and retain the original retrieval time. Remote fetch first passes through the existing local URL/DNS/redirect checks; this deliberately adds a local fetch before DeepSeek's Markdown extraction. DeepSeek performs its own remote retrieval, whose redirects and DNS are controlled by that service.

[DeepSeek's published price](https://api-docs.deepseek.com/guides/search/) is US$0.75 per 1,000 successful non-empty requests for each API, with billing starting 1 November 2026 at 00:00 Singapore time. The cost ledger and tool traces record request counts and estimated fees (zero before that date); cache hits do not add fees. These are published-rate estimates, not provider invoices. Search/fetch fees appear separately from model-token costs in `/cost`; the existing turn-finished token summary is unchanged.

GPT-6 Luna and GPT-6 Sol use `OPENAI_API_KEY` from the existing secret store. In Kestrel, select the model and adjust the **Thinking** slider: Off, Low, Medium, High, Extra high or Max. OpenAI defaults to Off and uses the Responses API so tools work at every effort level. DeepSeek Flash and V4 Pro offer Off, Low, High or Max and retain their High default. Choices are remembered separately per model in this browser, apply to the next message and stay fixed throughout its tool loop. Models without declared thinking controls hide the slider.

Higher effort can take longer and cost more. Existing step/time/spend and output-token limits still apply: reasoning consumes the output allowance, so a high-effort request can hit the output limit before producing an answer. Truncation is reported; the slider does not raise limits automatically. OpenAI usage includes reasoning output tokens. Completed encrypted reasoning is saved privately with the conversation and replayed only to the same brain/model/origin; it is never shown as answer text. Web search remains independent of model/effort. Saving an API key does not change the selected model or default.

## Skills

Type `/` in the chat to see them. Bundled skills: `pre-trade-check`, `position-review`, `earnings-review`, `why-did-it-move`, `strategy-scan`. The agent also picks a skill on its own when your question matches one.

- **Add your own:** create `~/FinSightData/agent/skills/<name>/SKILL.md`:
  ```
  ---
  name: my-skill
  description: when to use it
  ---
  instructions…
  ```
  It's picked up without a restart.
- **Install from GitHub** (text files only; review the result before use):
  ```bash
  npm run skills -- add https://github.com/<owner>/<repo>/tree/<ref>/<path-to-skill-folder>
  ```
- **Limits:** skills are instructions, not code. Scripts inside third-party skills are not executed, and skills get the same read-only tools as chat.

## Files and pictures

Attach with ⊕, paste, or drop: PNG/JPEG/GIF/WebP images and PDF/DOCX/TXT/MD/CSV/JSON documents, up to 15 MB each and 5 per message.

- **Documents** are text-extracted on your Mac, so every model can read them.
- **Images** need a vision model: Claude Haiku (API key) or Claude Code. DeepSeek will tell you to switch.

## Logs (for troubleshooting)

Every interaction is logged, one JSON line per event, in `~/FinSightData/agent/logs/YYYY-MM-DD.jsonl`. That covers API requests, full model requests and responses, tool calls and results, FinSight calls, MCP calls, uploads and errors. Logs are redacted, private (0600) and kept for 14 days.

- Under any answer, click **trace** to see its events.
- In chat, type `/logs` for recent errors.
- In a terminal:
  ```bash
  npm run logs -- turn_XXXX              # one answer, end to end
  npm run logs -- --kind model.error     # filter by kind
  ```

## Demo (no real data)

From the `finsight` folder, double-click `start-demo.command`, or run `npm run demo`. It starts FinSight on :8003 and a separate Kestrel on :8103 with a made-up portfolio in `~/FinSightDemo`. The PIN is 2468. Supported Intelligent UI views default on in demo mode, while explicit agent settings and model capability/credential checks still apply. `npm run demo:reset` reseeds it.

## Settings

Optional `~/FinSightData/agent/config.json` (validated at startup):

```json
{ "assistantName": "Kestrel", "defaultBrain": "deepseek-flash", "limits": { "dayUsd": 2, "turnUsd": 0.05, "turnSteps": 12 }, "edgarUserAgent": "Your Name your@email" }
```

SEC asks for a contact in the User-Agent; set `edgarUserAgent` before heavy EDGAR use.

## Use the same tools from Claude Code or Codex

```bash
claude mcp add finsight -- node <path-to>/finsight/agent/src/cli.ts mcp
```

## Add a strategy

Create `~/FinSightData/strategies/<id>/manifest.json` + `engine.js` (private, never committed):

```json
{ "apiVersion": 1, "kind": "strategy", "id": "my-setup", "name": "My setup", "version": "0.1.0", "status": "idea", "engine": "engine.js", "summary": "..." }
```

`engine.js` exports `run(bars, params)` returning `{ kind, stage: { code, label, detail }, setups, trades, open, stats }`, the same shape as the built-ins in `finsight/public/strategies.js`. Engines run sandboxed: no network or filesystem modules, no child processes, no files outside their folder, 10 s limit. Omit `engine` for a discretionary checklist strategy.

## Develop

```bash
npm run check
```

That runs type-check, tests and a secret scan.
