// FEAT-015 §4 event radar: shapes shared by lib/radar.ts and the panel.
export type RadarKind = 'EARNINGS' | 'EX-DIV' | 'FOMC';
export interface RadarItem {
  t: number; inDays: number; kind: RadarKind; symbol: string | null; estimated: boolean;
  held: boolean; weightPct: number | null;
  /** What to look at before the event; empty = nothing in your records asks for it. */
  prompts: string[];
  level: 'review' | 'info';
  detail?: string;
}
export interface RadarReport {
  asOf: number; horizonDays: number; items: RadarItem[];
  counts: { review: number; earningsHeld: number };
  sources: { events: boolean; fomcScheduleThrough: string | null };
  notes: string[];
}
