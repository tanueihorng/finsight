import test from 'node:test';
import assert from 'node:assert/strict';
import { CARD_DEFS, DEFAULT_CARDS, DEFAULT_ORDER, moveCard, parsePrefs, toggleCard, visibleCards } from './cards.ts';
import type { Summary } from '../../../../shared/types.ts';

const s = { totalValue: 92967.48, totalCost: 66100, cashBase: 0, netWorth: 92967.48, totalUnrealized: 26862.97, totalUnrealizedPct: 40.64,
  totalStockPnl: 19282.24, totalFxPnl: 7580.74, dayPnl: 772.15, dayPct: 0.84, realizedPnl: 0, realizedStockPnl: 0, realizedFxPnl: 0, realizedLegacy: 0 } as Summary;
const input = { s, base: 'SGD', positions: [], cash: [], fxRisk: null };

test('card values match the legacy formatting', () => {
  assert.deepEqual(CARD_DEFS.net_worth!.render(input), { value: 'S$92,967.48', sub: 'holdings (no cash set)' });
  assert.deepEqual(CARD_DEFS.day_pnl!.render(input), { value: '+S$772.15', sub: 'today', signVal: 772.15 });
  assert.deepEqual(CARD_DEFS.total_value!.render(input), { value: 'S$92,967.48', sub: 'invested · cost S$66.10K' });
  assert.deepEqual(CARD_DEFS.fx_exposure!.render(input), { value: '—', sub: 'foreign currency' });
  const fxRisk = { totalValue: 92967.48, foreignBase: 66330, exposures: [{ ccy: 'USD' }] } as never;
  assert.deepEqual(CARD_DEFS.fx_exposure!.render({ ...input, fxRisk }), { value: 'S$66.33K', sub: '71% in USD' });
});

test('saved prefs parse like legacy, including the one-time NET WORTH-first upgrade', () => {
  assert.deepEqual(parsePrefs(null).prefs, { order: DEFAULT_ORDER, enabled: DEFAULT_CARDS, nwFirst: true });
  // saved defaults are not upgraded again (the legacy bug this fixes)
  assert.equal(parsePrefs(JSON.stringify(parsePrefs(null).prefs)).migrated, false);
  assert.equal(parsePrefs('{bad').migrated, false);
  const old = parsePrefs(JSON.stringify({ order: ['day_pnl', 'gone'], enabled: ['day_pnl'] }));
  assert.equal(old.migrated, true);
  assert.equal(old.prefs.order[0], 'net_worth');
  assert.ok(!old.prefs.order.includes('gone'));
  assert.deepEqual(old.prefs.enabled, ['net_worth', 'day_pnl']);
  assert.equal(parsePrefs(JSON.stringify({ ...old.prefs })).migrated, false);
  assert.deepEqual(parsePrefs(JSON.stringify({ order: DEFAULT_ORDER, enabled: [], nwFirst: true })).prefs.enabled, DEFAULT_CARDS);
});

test('toggle and reorder', () => {
  const p = { order: ['a', 'b', 'c'], enabled: ['a', 'c'] };
  assert.deepEqual(visibleCards(p), ['a', 'c']);
  assert.deepEqual(toggleCard(p, 'b', true).enabled, ['a', 'c', 'b']);
  assert.deepEqual(toggleCard(p, 'a', false).enabled, ['c']);
  assert.deepEqual(moveCard(p, 'b', 'up').order, ['b', 'a', 'c']);
  assert.equal(moveCard(p, 'a', 'up'), p);
});
