# FEAT-024 · Kestrel image optimization

Deferred proposal, 2026-11-15 SGT. No execution task assigned.
Source: [agent capability evaluation](../architecture/agent-capability-eval.md),
criteria 13 and 15.

## Problem

Chat uploads accept images up to 15 MB (`MAX_UPLOAD_BYTES` in
`agent/src/uploads.ts`). Vision brains receive the original file unchanged.
Anthropic's API accepts about 5 MB per image, so large screenshots or phone
photos are likely to fail on the Claude brains. This comes from code reading;
it has not been reproduced. History is rebuilt on every step of a turn, so
`imageBase64` reads and re-encodes the same full-size image on each step.

## Outcome

Every vision brain receives a right-sized copy of each image, prepared once.
The user's original stays on disk, unchanged.

## First release

- At upload, make one model copy: long edge at most about 1,600 px, recompressed
  (JPEG for photos; PNG kept for screenshots when it is smaller), stored 0600
  next to the original. The upload record keeps the original's size, the
  copy's size and the dimensions.
- Vision brains send the model copy. A copy that still exceeds the smallest
  configured provider limit is refused at upload with a clear message, not
  mid-turn.
- Prepare the copy once per upload, not per step. Existing uploads get a copy
  the first time they are used.
- Context accounting (`IMAGE_CONTEXT_TOKENS`) stays a conservative estimate.

## Acceptance

- A 12 MB, 6000×4000 fixture produces a copy under the provider limit with its
  aspect ratio preserved, and the original is byte-identical afterwards.
- A turn with several steps reads and encodes each image copy once.
- Mock brains for each vision transport (Anthropic, OpenAI-compatible,
  Responses) receive the copy, not the original.
- A small screenshot is not enlarged, and its text stays legible.
- One paid check per vision brain with a large image, within a stated cost
  cap and only with the owner's approval.

## Not in scope

Cropping, OCR, or image editing; changing what the user sees in the chat.
