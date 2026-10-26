# Per-turn thinking effort and OpenAI Responses

Date: 2026-10-26. Status: implemented in isolated branch for review.

Kestrel tools need to work while a model reasons. OpenAI Luna/Sol permit tool
calling through Responses at nonzero reasoning effort; the previous Chat
Completions adapter only supports their tools with effort none. Use an explicit
`openai-responses` transport for these manifests. Keep the existing compatible
transport for DeepSeek and other providers. No SDK dependency is added.

A manifest declares supported levels and its default. The server validates a
per-send effort before mutating the chat; the engine passes that immutable value
to every step/retry. The browser shows a discrete range slider only when supported,
remembers choices per model and sends the model/effort captured at submission.
Shared cached brains are never mutated to hold a user's effort.

Responses requests use store:false and request encrypted reasoning. Completed
output items are stored in private providerExtra and replayed only for matching
brain/model/origin. This preserves tool IDs and reasoning across reloads without
provider-side conversation storage. Neutral blocks support switching providers.
Context sizing counts opaque extras. Reasoning never appears in visible text or
HTTP thread payloads. Incomplete/refused responses never execute tool calls.

Existing output-token, time and spend limits are unchanged. High effort may
exhaust those limits; this is disclosed instead of silently raising spending.
No additional provider models, automatic model refresh or default switch is part
of this change.

Primary references:
- https://developers.openai.com/api/docs/models/gpt-6-luna
- https://developers.openai.com/api/docs/models/gpt-6-sol
- https://developers.openai.com/api/docs/guides/reasoning
- https://developers.openai.com/api/reference/resources/responses/streaming-events
- https://api-docs.deepseek.com/guides/thinking_mode/
