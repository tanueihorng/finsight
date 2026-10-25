import { api } from '../../api/client.ts';
import type { MutationKind } from '../../api/invalidation.ts';
import { blockIfAll, requestNotify, selectSymbol, setStatus } from '../../legacy/app.ts';
import { signStr } from '../../ui/format.ts';
import type { Portfolio } from '../../../../shared/types.ts';
import { HELP, parseCommand } from './commands.ts';

// Runs one command-bar line (F7). Every write goes through bus.write(kind),
// so islands and the remaining legacy readers refresh as before.
const bus = () => window.FinSight.bus;
const qs = () => {
  const { base, account } = window.FinSight.store.getState();
  return `?base=${encodeURIComponent(base)}&account=${encodeURIComponent(account || '')}`;
};
const post = <T,>(path: string, body: unknown) => api<T>(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
// Watchlist, alert and withholding writes didn't wait for the refresh in legacy.
const later = (kind: MutationKind) => { void bus().write(kind); };

export async function runCommand(raw: string): Promise<void> {
  const c = parseCommand(raw);
  try {
    switch (c.kind) {
      case 'none': return;
      case 'help': return setStatus(HELP, 'ok');
      case 'clear': return setStatus('');
      case 'usage': return setStatus(c.msg, 'err');
      case 'add':
        if (blockIfAll()) return;
        await post('/api/portfolio/buy' + qs(), { symbol: c.sym, quantity: c.qty, price: c.price, date: c.date });
        setStatus(`BOUGHT ${c.qty} ${c.sym.toUpperCase()} @ ${c.price}${c.date ? ' on ' + c.date : ''}`, 'ok');
        await bus().write('buy'); return;
      case 'sell': {
        const res = await post<Portfolio>('/api/portfolio/sell' + qs(), { symbol: c.sym, quantity: c.qty, price: c.price });
        const r = res.lastRealized;
        setStatus(`SOLD ${c.qty} ${c.sym.toUpperCase()}  ·  realized ${signStr(r)} `, (r ?? 0) >= 0 ? 'ok' : 'err');
        await bus().write('sell'); return;
      }
      case 'del':
        await post('/api/portfolio/delete' + qs(), { symbol: c.sym });
        setStatus(`REMOVED ${c.sym.toUpperCase()} from portfolio`, 'ok');
        await bus().write('delete'); return;
      case 'quote': selectSymbol(c.sym); return setStatus(`Loading ${c.sym}…`, 'ok');
      case 'watch':
        await post('/api/watchlist/add', { symbol: c.sym });
        setStatus(`Watching ${c.sym.toUpperCase()}`, 'ok'); return later('watchlist-add');
      case 'unwatch':
        await post('/api/watchlist/remove', { symbol: c.sym });
        setStatus(`Unwatched ${c.sym.toUpperCase()}`, 'ok'); return later('watchlist-remove');
      case 'alert':
        await post('/api/alerts/add', { symbol: c.sym, op: c.op, price: c.price });
        setStatus(`Alert set: ${c.sym.toUpperCase()} ${c.op} ${c.price}`, 'ok'); later('alerts-add'); return requestNotify();
      case 'news':
        // NEWS alone shows market news without changing the selected security (A2).
        if (c.sym) selectSymbol(c.sym); else void bus().invalidate('news-market');
        return setStatus('Loading news…', 'ok');
      case 'undo': return await window.FinSight.actions?.undo();
      case 'ledger': window.FinSight.store.setState({ ledgerOpen: true }); return;
      case 'cash':
        if (blockIfAll()) return;
        return await window.FinSight.actions?.setCashBalance(c.ccy, c.amt);
      case 'wht':
        await post('/api/settings/withholding', { market: c.mkt, pct: c.pct });
        setStatus(`Dividend withholding for ${c.mkt.toUpperCase()} set to ${c.pct}%`, 'ok'); return later('withholding');
      case 'markets': void bus().invalidate('markets'); return setStatus('Refreshing world markets…', 'ok');
    }
  } catch (e) {
    setStatus('ERROR: ' + (e as Error).message, 'err');
  }
}
