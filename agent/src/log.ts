// Structured JSON logs (one line per event) with a redaction pass applied to
// every record, so a secret that reaches a log call never reaches disk.
const secrets = new Set<string>();
const PATTERNS: RegExp[] = [
  /sk-[A-Za-z0-9_-]{16,}/g,                // provider API keys
  /tvly-[A-Za-z0-9_-]{16,}/g,              // Tavily
  /Bearer\s+[A-Za-z0-9._~+/=-]{16,}/gi,    // auth headers
];

export function registerSecret(v: string): void { if (v && v.length >= 8) secrets.add(v); }

export function redact(text: string): string {
  let out = text;
  for (const s of secrets) out = out.split(s).join('[REDACTED]');
  for (const re of PATTERNS) out = out.replace(re, '[REDACTED]');
  return out;
}

export function redactValue<T>(v: T): T {
  if (v == null) return v;
  return JSON.parse(redact(JSON.stringify(v))) as T;
}

type Level = 'debug' | 'info' | 'warn' | 'error';
let sink: (line: string) => void = (line) => process.stderr.write(line + '\n');
export function setLogSink(fn: (line: string) => void): void { sink = fn; }

export function log(level: Level, event: string, fields: Record<string, unknown> = {}): void {
  if (level === 'debug' && !process.env.AGENT_DEBUG) return;
  sink(redact(JSON.stringify({ ts: new Date().toISOString(), level, event, ...fields })));
}
