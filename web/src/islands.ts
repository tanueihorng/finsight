import type { ComponentType } from 'react';
import * as ClockIsland from './features/clock/ClockIsland.tsx';
import * as SummaryIsland from './features/summary/SummaryIsland.tsx';
import * as PositionsIsland from './features/positions/PositionsIsland.tsx';
import * as NewsIsland from './features/news/NewsIsland.tsx';
import * as AddFormIsland from './features/addform/AddFormIsland.tsx';
import * as CashEditorIsland from './features/cash/CashEditorIsland.tsx';
import * as LedgerIsland from './features/ledger/LedgerIsland.tsx';
import * as ImportIsland from './features/ledger/ImportIsland.tsx';
import * as CommandIsland from './features/command/CommandIsland.tsx';
import * as StatusIsland from './features/command/StatusIsland.tsx';
import * as FooterIsland from './features/command/FooterIsland.tsx';
import * as AccountIsland from './features/topbar/AccountIsland.tsx';
import * as AccountsModalIsland from './features/topbar/AccountsModalIsland.tsx';
import * as BaseIsland from './features/topbar/BaseIsland.tsx';
import * as ProfileIsland from './features/topbar/ProfileIsland.tsx';
import * as PeekIsland from './features/topbar/PeekIsland.tsx';
import * as ModeIsland from './features/topbar/ModeIsland.tsx';
import * as SetupIsland from './features/topbar/SetupIsland.tsx';
import * as LockIsland from './features/lock/LockIsland.tsx';
import * as LockButtonIsland from './features/lock/LockButtonIsland.tsx';
import * as LayoutModalIsland from './features/layout/LayoutModalIsland.tsx';
import * as LayoutButtonIsland from './features/layout/LayoutButtonIsland.tsx';
import * as CalendarIsland from './features/macro/CalendarIsland.tsx';
import * as WorldBankIsland from './features/macro/WorldBankIsland.tsx';
import * as FredIsland from './features/macro/FredIsland.tsx';
import * as InflationIsland from './features/macro/InflationIsland.tsx';
import * as WatchlistIsland from './features/watchlist/WatchlistIsland.tsx';
import * as AlertsIsland from './features/alerts/AlertsIsland.tsx';
import * as DividendsIsland from './features/dividends/DividendsIsland.tsx';
import * as ActivityIsland from './features/activity/ActivityIsland.tsx';
import * as FxRiskIsland from './features/fxrisk/FxRiskIsland.tsx';
import * as TradeSheetIsland from './features/trade/TradeSheetIsland.tsx';
import * as DialogIsland from './ui/dialog.tsx';
import * as ToastIsland from './ui/toast.tsx';
type IslandModule = { default: ComponentType };
export type IslandRegistry = Record<string, () => Promise<IslandModule>>;

// H1: React 19 holds back revealing Suspense content until 300 ms after the
// last fallback was shown, across every root. Each island used to suspend on
// its chunk, so the whole page appeared ~300 ms late. App.tsx's hosts now
// wait for their chunk before mounting; once it has loaded, its loader
// returns a thenable that calls back at once, so React.lazy resolves during
// the first render and no fallback is shown. A failed load is not remembered:
// the next call imports again, as before. Each wrapper reads as its original
// loader, whose import() names the content-hashed chunk: shell/chunkGuard.ts
// identifies the build and each island by that text (H4).
function preloadable(loaders: IslandRegistry): IslandRegistry {
  const out: IslandRegistry = {};
  for (const [id, load] of Object.entries(loaders)) {
    let mod: IslandModule | undefined;
    const wrapped = () => mod
      ? ({ then: (ok: (m: IslandModule) => unknown) => ok(mod!) } as unknown as Promise<IslandModule>)
      : load().then((m) => (mod = m));
    wrapped.toString = () => String(load);
    out[id] = wrapped;
  }
  return out;
}

// Append one entry per panel. Light panels are bundled into main.js: each lazy
// chunk was one more request before the first render (H1). The heavy ones
// (analytics charts, detail chart, Kestrel) and markets stay lazy chunks.
export const islands: IslandRegistry = preloadable({
  clock: () => Promise.resolve(ClockIsland),
  // Stays a chunk: upgrade.sw.spec deletes it to check the SW's hashed-chunk fallback.
  markets: () => import('./features/markets/MarketsIsland.tsx'),
  summary: () => Promise.resolve(SummaryIsland),
  positions: () => Promise.resolve(PositionsIsland),
  news: () => Promise.resolve(NewsIsland),
  'add-form': () => Promise.resolve(AddFormIsland),
  'cash-editor': () => Promise.resolve(CashEditorIsland),
  ledger: () => Promise.resolve(LedgerIsland),
  import: () => Promise.resolve(ImportIsland),
  performance: () => import('./features/analytics/PerformanceIsland.tsx'),
  wealth: () => import('./features/analytics/WealthIsland.tsx'),
  allocation: () => import('./features/analytics/AllocationIsland.tsx'),
  heatmap: () => import('./features/analytics/HeatmapIsland.tsx'),
  detail: () => import('./features/detail/DetailIsland.tsx'),
  command: () => Promise.resolve(CommandIsland),
  status: () => Promise.resolve(StatusIsland),
  footer: () => Promise.resolve(FooterIsland),
  account: () => Promise.resolve(AccountIsland),
  accounts: () => Promise.resolve(AccountsModalIsland),
  base: () => Promise.resolve(BaseIsland),
  profile: () => Promise.resolve(ProfileIsland),
  peek: () => Promise.resolve(PeekIsland),
  mode: () => Promise.resolve(ModeIsland),
  setup: () => Promise.resolve(SetupIsland),
  lock: () => Promise.resolve(LockIsland),
  'lock-button': () => Promise.resolve(LockButtonIsland),
  layout: () => Promise.resolve(LayoutModalIsland),
  'layout-button': () => Promise.resolve(LayoutButtonIsland),
  kestrel: () => import('./features/kestrel/KestrelIsland.tsx'),
  calendar: () => Promise.resolve(CalendarIsland),
  worldbank: () => Promise.resolve(WorldBankIsland),
  fred: () => Promise.resolve(FredIsland),
  inflation: () => Promise.resolve(InflationIsland),
  watchlist: () => Promise.resolve(WatchlistIsland),
  alerts: () => Promise.resolve(AlertsIsland),
  dividends: () => Promise.resolve(DividendsIsland),
  activity: () => Promise.resolve(ActivityIsland),
  fxrisk: () => Promise.resolve(FxRiskIsland),
  trade: () => Promise.resolve(TradeSheetIsland),
  dialog: () => Promise.resolve(DialogIsland),
  toast: () => Promise.resolve(ToastIsland),
});
