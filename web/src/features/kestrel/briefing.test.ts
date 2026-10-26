import test from 'node:test';
import assert from 'node:assert/strict';
import { asks, brief, eventTime, pctText, portfolioLine, prevClose, symbolLine, usMarket, type Bars } from './briefing.ts';
import type { CalendarResponse, EventItem, Portfolio } from '../../../../shared/types.ts';

const NY = (iso: string) => Date.parse(iso); // ISO with an explicit New York offset
const pos = (symbol: string, changePct: number | null, quoted = true) => ({ symbol, changePct, quoted }) as Portfolio['positions'][number];
const portfolio = (positions: Portfolio['positions']) => ({ base: 'SGD', positions, summary: { dayPct: 1.2, dayPnl: 150 } }) as Portfolio;

test('US regular hours: open, before the bell, after the close and over the weekend', () => {
  assert.deepEqual(usMarket(NY('2026-10-26T10:15:00-04:00')), { open: true, label: 'US open · closes in 6h' });
  assert.deepEqual(usMarket(NY('2026-10-26T09:00:00-04:00')), { open: false, label: 'US closed · opens in 30m' });
  assert.deepEqual(usMarket(NY('2026-10-26T16:00:00-04:00')), { open: false, label: 'US closed · opens in 18h' });
  assert.deepEqual(usMarket(NY('2026-10-30T17:00:00-04:00')), { open: false, label: 'US closed · opens in 3d' }); // Friday evening
});

test('brief picks the largest absolute mover and the nearest held event', () => {
  const now = NY('2026-10-26T10:00:00-04:00');
  const events: EventItem[] = [
    { symbol: 'MSFT', kind: 'EARNINGS', t: now + 3 * 864e5, estimated: false, held: true },
    { symbol: 'VOO', kind: 'EX-DIV', t: now + 864e5, estimated: false, held: false, amount: null },
  ];
  const cal = { nextFomc: { start: '', end: '', sep: false, decisionMs: now + 2 * 864e5 } } as CalendarResponse;
  const b = brief(portfolio([pos('AAPL', 1.1), pos('NVDA', -3.4), pos('OLD', 9, false)]), events, cal, now);
  assert.deepEqual(b.mover, { symbol: 'NVDA', pct: -3.4 });
  assert.equal(b.next?.label, 'FOMC decision'); // the unheld VOO dividend is skipped
  assert.equal(b.dayPct, 1.2);
  const none = brief(portfolio([]), [], undefined, now);
  assert.equal(none.dayPct, null); assert.equal(none.mover, null); assert.equal(none.next, null);
});

test('questions: one per colour, built from the briefing and the page context', () => {
  const now = Date.now();
  const b = brief(portfolio([pos('NVDA', -3.4)]), [{ symbol: 'MSFT', kind: 'EARNINGS', t: now + 864e5, estimated: false, held: true }], undefined, now);
  assert.deepEqual(asks(b, { view: 'terminal', symbol: 'VOO' }, false).map((a) => [a.kind, a.text]), [
    ['portfolio', 'Why did NVDA move -3.40% today?'], ['event', 'What should I watch in MSFT earnings?'],
    ['macro', 'What is my currency and sector exposure?'], ['strategy', 'What do my strategies say about VOO right now?'],
  ]);
  const quiet = brief(portfolio([pos('AAPL', 0.2)]), [], undefined, now);
  assert.deepEqual(asks(quiet, { view: 'terminal' }, true).map((a) => a.text), [
    'How is my portfolio doing today, and what moved it?', 'What earnings or dividends are coming up for my holdings?',
    'Show my holdings as a table', '/strategy-scan any live setups in my holdings?',
  ]);
  assert.equal(pctText(12.345), '+12.3%');
});

test('event times: company events show a date, the FOMC decision a time', () => {
  const now = new Date(2026, 9, 26, 9, 0).getTime();
  assert.equal(eventTime(new Date(2026, 9, 27).getTime(), now, false), 'tomorrow');
  assert.match(eventTime(new Date(2026, 9, 26, 14, 0).getTime(), now), /^today 14:00$/);
});

test('intraday lines: holdings value in base currency, prices carried forward across markets', () => {
  const bars = {
    AAPL: { symbol: 'AAPL', range: '1d', interval: '5m', meta: { prevClose: 9 }, points: [{ t: 1, c: 10 }, { t: 3, c: 12 }] },
    D05: { symbol: 'D05', range: '1d', interval: '5m', meta: null, points: [{ t: 2, c: 40 }] },
    BAD: { error: 'no data' },
  } as unknown as Bars;
  const p = (symbol: string, quantity: number, fxRate: number) => ({ symbol, quantity, fxRate, quoted: true }) as Portfolio['positions'][number];
  // t=1: 2*1.3*10 + 1*1*40 (D05 counts at its first bar); t=2: same; t=3: AAPL moves to 12
  assert.deepEqual(portfolioLine([p('AAPL', 2, 1.3), p('D05', 1, 1), p('BAD', 5, 1)], bars), [66, 66, 71.2]);
  assert.deepEqual(symbolLine(bars, 'aapl'), [10, 12]);
  assert.equal(prevClose(bars, 'AAPL'), 9);
  assert.deepEqual(portfolioLine([p('AAPL', 1, 1)], undefined), []);
});
