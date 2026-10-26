// Synthetic accepted snapshot at the API boundary. Backend binding is covered
// separately by agent/test/ui.test.ts; these fixtures exercise browser delivery.
export function uiFixture(threadId, turnId) {
  const source = { callId: 'cash1', tool: 'get_cash', asOf: '2026-10-26T01:00:00.000Z', scope: 'Account: ALL · reporting currency: SGD', note: '' };
  return { id: `ui_${turnId}`, threadId, turnId, callId: `view_${turnId}`, createdAt: 1792976400000, spec: { version: 1,
    fallback: 'Snapshot · get_cash · 2026-10-26T01:00:00.000Z\nTotal cash: SGD 4,350.00\nUSD | USD 1,000.00 | SGD 1,350.00\nSGD | SGD 3,000.00 | SGD 3,000.00',
    components: [
      { id: 'stats', kind: 'stat_grid', source, items: [{ field: '/totalBase', label: 'Total cash', cell: { value: 4350, text: 'SGD 4,350.00' } }] },
      { id: 'cash', kind: 'table', source, columns: [{ field: '/ccy', label: 'Currency' }, { field: '/amount', label: 'Native cash' }, { field: '/base', label: 'Cash value' }], shown: 2, available: 2,
        rows: [[{ value: 'USD', text: 'USD' }, { value: 1000, text: 'USD 1,000.00' }, { value: 1350, text: 'SGD 1,350.00' }], [{ value: 'SGD', text: 'SGD' }, { value: 3000, text: 'SGD 3,000.00' }, { value: 3000, text: 'SGD 3,000.00' }]] },
    ] } };
}
