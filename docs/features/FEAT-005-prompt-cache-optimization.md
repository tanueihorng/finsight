# FEAT-005: Prompt Cache Optimization & Template Deduplication

- **ID:** FEAT-005
- Status: Merged and verified in `d9ee5c8` (2026-10-27); deployment remains separate.
- **Execution task:** `PROMPTCACHE-001`
- **Priority:** Medium
- **Category:** Performance & Cost

---

## 1. Summary
Optimize the agent system prompt in [prompt.ts](../../agent/src/chat/prompt.ts) to maximize prefix cache hit rates on modern LLM providers (Anthropic prompt caching, DeepSeek prefix caching, OpenAI).

---

## 2. Requirements & Acceptance Criteria
- [x] **Move dynamic date/time:** The prompt currently starts with `Today is ${date} (${tz})` on line 7, which can reduce reusable prefix coverage when the date changes, depending on provider caching rules. Move the date/time string to the end of the prompt or into a dynamic turn header so the large static prompt block stays 100% byte-identical.
- [x] **Deduplicate attachment instructions:** Consolidate redundant instructions between `Documents and conversation context` and `Attachments`.
- [x] **Measure cache hits:** Use synthetic repeated and cross-date requests, provider usage fields and dated logs; record cache reads, cost and limitations without private portfolio data. Do not infer a guaranteed hit rate from prompt layout alone.


Implementation and evidence — 2026-10-27 SGT:

Static instructions and installed skill index precede an explicitly delimited runtime-date suffix. Intelligent UI guidance is inserted before that suffix. Anthropic places its system cache breakpoint at the end of the stable block and sends the date in a separate uncached text block. Attachment trust and paging instructions occur once. A forward-only SQLite migration adds nullable cache read/write counters to trace steps; unknown counters remain null.

Opt-in synthetic probe: `env -u OPENAI_API_KEY AGENT_NO_KEYCHAIN=1 node agent/scripts/cache-probe.ts <private-agent-home> <output-dir>`. Reads only the DeepSeek credential from that home; no personal chat DB or portfolio. Six calls, 32 output tokens maximum, stop at US$0.02 in recorded spend (one in-flight call may exceed the stop by its own cost).

Observed DeepSeek Flash results: old prompt cross-date read 0/825 tokens; revised prompt cross-date read 640/800 tokens (80%). Same-date repeat: old 640/825, revised 640/800. Total configured-rate cost US$0.00090522. Isolated `synthetic-cache.db` and JSON metrics are in the private harness packet. This is a short sequence using synthetic displayed dates, not elapsed-day measurement; eviction, TTLs, minimum prompt length and provider routing still apply. No guaranteed daily savings or qualification of other providers is claimed.

Primary references: [OpenAI prefix caching](https://developers.openai.com/api/docs/guides/prompt-caching), [Anthropic caching hierarchy and breakpoints](https://platform.claude.com/docs/en/build-with-claude/prompt-caching). Retrieved 2026-10-27 SGT.
