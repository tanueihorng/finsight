import { csvCell } from '../ui/csv.ts';
import { allCharts, chartHooks, setChartWatch } from './chartHooks.ts';
import { loadAccounts } from './boot.ts';

// Window names that existing E2E specs (three of them baseline) and console
// users still call, now backed by the React app (X1). They trigger the same
// refresh paths a user action would; nothing in the app itself uses them.
// window.detailChart is set by ChartHost.
const bus = () => window.FinSight.bus;
Object.assign(window, {
  csvCell,                                                // baseline/import-export
  loadPortfolio: () => bus().invalidate('portfolio'),     // baseline/accounts, PILOT-2: "what the 15 s poll does"
  loadWatchlist: () => bus().invalidate('watchlist'),     // baseline/session, PILOT-1, D1: any API call while locked
  loadDividends: () => bus().invalidate('dividends'),     // B3
  loadAccounts,                                           // F4
  allCharts,                                              // phase2-regressions
  FinSightChartHooks: chartHooks,                         // phase2-regressions
  FinSightLegacy: { setChartWatch },                      // B1: the watchlist's chart feed adapter
});
