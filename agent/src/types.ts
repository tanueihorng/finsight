// Provider-neutral conversation model. Brains translate to and from their own
// wire formats; the store only ever holds these shapes, so switching the model
// mid-thread keeps the full history.
export type TextBlock = { type: 'text'; text: string };
export type ToolCallBlock = { type: 'tool_call'; id: string; name: string; args: unknown };
export type ToolResultBlock = { type: 'tool_result'; callId: string; name: string; ok: boolean; content: string };
export type CitationBlock = { type: 'citation'; url: string; title?: string; retrievedAt: string; class?: SourceClass };
export type NoticeBlock = { type: 'notice'; kind: string; text: string };
/** A user-uploaded file (stored under <home>/uploads/<id>). */
export type AttachmentBlock = { type: 'attachment'; id: string; name: string; mime: string; kind: 'image' | 'document'; chars?: number };
/** Transient: image bytes resolved just before a vision-capable model call; never stored. */
export type ImageBlock = { type: 'image'; mime: string; data: string; name: string };
export type Block = TextBlock | ToolCallBlock | ToolResultBlock | CitationBlock | NoticeBlock | AttachmentBlock | ImageBlock;

export type Role = 'user' | 'assistant' | 'tool';
export type Msg = { role: Role; blocks: Block[]; providerExtra?: { brain: string; data: unknown } };

export type SourceClass = 'primary' | 'secondary' | 'unverified';

export type Usage = { inputTokens: number | null; outputTokens: number | null; cacheReadTokens?: number | null; cacheWriteTokens?: number | null };

export type PageContext = {
  view?: string; symbol?: string; timeframe?: string; strategy?: string; account?: string; base?: string;
};

export class AgentError extends Error {
  code: string; details?: unknown; status: number;
  constructor(code: string, message: string, status = 400, details?: unknown) {
    super(message); this.code = code; this.status = status; this.details = details;
  }
}
