# FEAT-005: Prompt Cache Optimization & Template Deduplication

- **ID:** FEAT-005
- **Status:** Verified by existing feature session; uncommitted/unmerged, integration pending
- **Execution task:** `PROMPTCACHE-001`
- **Priority:** Medium
- **Category:** Performance & Cost

---

## 1. Summary
Optimize the agent system prompt in [prompt.ts](../../agent/src/chat/prompt.ts) to maximize prefix cache hit rates on modern LLM providers (Anthropic prompt caching, DeepSeek prefix caching, OpenAI).

---

## 2. Requirements & Acceptance Criteria
- [ ] **Move dynamic date/time:** The prompt currently starts with `Today is ${date} (${tz})` on line 7, which can reduce reusable prefix coverage when the date changes, depending on provider caching rules. Move the date/time string to the end of the prompt or into a dynamic turn header so the large static prompt block stays 100% byte-identical.
- [ ] **Deduplicate attachment instructions:** Consolidate redundant instructions between `Documents and conversation context` and `Attachments`.
- [ ] **Measure cache hits:** Use synthetic repeated and cross-date requests, provider usage fields and dated logs; record cache reads, cost and limitations without private portfolio data. Do not infer a guaranteed hit rate from prompt layout alone.
