// Typed calls into legacy public/app.js. Its top-level function declarations
// are window properties. Each wrapper goes away when the owning card migrates
// that function (docs/frontend-migration/COUPLING.md §A4).
interface LegacyAppGlobals {
  selectSymbol?: (symbol: string) => void; // E1 turns this into a store write
  setStatus?: (msg: string, kind?: 'ok' | 'err' | '') => void; // command-bar status line, shell (F7)
  blockIfAll?: () => boolean; // refuses trades in the All Accounts view (F8)
  analyticsStale?: (which: { perf?: boolean; wealth?: boolean }) => void; // C3 removes
  loadWealth?: () => Promise<void>; // C3 turns this into a query
  setFooter?: (msg: string) => void; // footer message line, shell (F7)
}
const legacy = () => window as unknown as LegacyAppGlobals;

export function selectSymbol(symbol: string): void {
  legacy().selectSymbol?.(symbol);
}

export function setStatus(msg: string, kind: 'ok' | 'err' | '' = ''): void {
  legacy().setStatus?.(msg, kind);
}

// True (and shows the reason) when the All Accounts view is active.
export function blockIfAll(): boolean {
  return legacy().blockIfAll?.() ?? false;
}

// Make the legacy performance / net-worth panels refetch on their next refresh.
export function analyticsStale(which: { perf?: boolean; wealth?: boolean }): void {
  legacy().analyticsStale?.(which);
}
export function loadWealth(): void {
  void legacy().loadWealth?.();
}
export function setFooter(msg: string): void {
  legacy().setFooter?.(msg);
}
