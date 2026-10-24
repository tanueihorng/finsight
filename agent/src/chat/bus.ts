// Event bus: every event is persisted first (so SSE clients can replay from
// Last-Event-ID after a reconnect), then pushed to live subscribers.
// Text deltas are coalesced (~40 ms) to avoid one DB write per token.
import type { DB, Evt } from '../store/db.ts';
import { appendEvent } from '../store/db.ts';

type Sub = (e: Evt) => void;

export class EventBus {
  private subs = new Map<string, Set<Sub>>();
  private pending = new Map<string, { text: string; turnId: string; timer: NodeJS.Timeout }>();
  private db: DB;
  constructor(db: DB) { this.db = db; }

  subscribe(threadId: string, fn: Sub): () => void {
    let set = this.subs.get(threadId);
    if (!set) { set = new Set(); this.subs.set(threadId, set); }
    set.add(fn);
    return () => { set!.delete(fn); if (!set!.size) this.subs.delete(threadId); };
  }

  emit(threadId: string, type: string, payload: unknown): Evt {
    this.flush(threadId);
    return this.write(threadId, type, payload);
  }

  delta(threadId: string, turnId: string, text: string): void {
    const p = this.pending.get(threadId);
    if (p && p.turnId === turnId) { p.text += text; return; }
    this.flush(threadId);
    this.pending.set(threadId, { text, turnId, timer: setTimeout(() => this.flush(threadId), 40) });
  }

  flush(threadId: string): void {
    const p = this.pending.get(threadId);
    if (!p) return;
    clearTimeout(p.timer); this.pending.delete(threadId);
    if (p.text) this.write(threadId, 'message.delta', { turnId: p.turnId, text: p.text });
  }

  private write(threadId: string, type: string, payload: unknown): Evt {
    const e = appendEvent(this.db, threadId, type, payload);
    for (const fn of this.subs.get(threadId) ?? []) { try { fn(e); } catch { /* a broken client must not break the turn */ } }
    return e;
  }
}
