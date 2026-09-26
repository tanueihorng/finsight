'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { splitCsvLine, applyExchangeSuffix, parseCsv, parseIbkrDividends } = require('../lib/csv');

test('splitCsvLine honours quotes and escaped quotes', () => {
  assert.deepEqual(splitCsvLine('a,"b,c","d ""e"""'), ['a', 'b,c', 'd "e"']);
});

test('applyExchangeSuffix maps exchanges, leaves suffixed symbols', () => {
  assert.equal(applyExchangeSuffix('d05', 'SGX'), 'D05.SI');
  assert.equal(applyExchangeSuffix('700', 'SEHK'), '700.HK');
  assert.equal(applyExchangeSuffix('AAPL', 'NASDAQ'), 'AAPL');
  assert.equal(applyExchangeSuffix('BRK-B', 'NYSE'), 'BRK-B');
});

test('parseCsv: simple format with header and date', () => {
  const rows = parseCsv('symbol,quantity,avg_price,date\nAAPL,10,195.50,2024-06-03\nD05.SI,200,38.20\n');
  assert.equal(rows.length, 2);
  assert.deepEqual(rows[0], { symbol: 'AAPL', quantity: 10, price: 195.5, dateMs: Date.parse('2024-06-03') });
  assert.equal(rows[1].dateMs, null);
});

test('parseCsv: no header falls back to positional columns', () => {
  const rows = parseCsv('MSFT,5,380\n');
  assert.deepEqual(rows[0], { symbol: 'MSFT', quantity: 5, price: 380, dateMs: null });
});

test('parseCsv: broker-style headers, money formatting, exchange column', () => {
  const csv = 'Stock Code,Name,Market,Quantity,Average Cost,Market Value\n' +
    'D05,DBS,SG,"1,000",$38.20,"40,000"\nAAPL,Apple,US,3,150,600\n';
  const rows = parseCsv(csv);
  assert.equal(rows[0].symbol, 'D05.SI');
  assert.equal(rows[0].quantity, 1000);
  assert.equal(rows[0].price, 38.2);
  assert.equal(rows[1].symbol, 'AAPL');
});

test('parseCsv: IBKR activity statement', () => {
  const csv = [
    'Financial Instrument Information,Header,Asset Category,Symbol,Description,Conid,Security ID,Multiplier,Listing Exch',
    'Financial Instrument Information,Data,Stocks,D05,DBS GROUP,1,x,1,SGX',
    'Open Positions,Header,DataDiscriminator,Asset Category,Currency,Symbol,Quantity,Mult,Cost Price',
    'Open Positions,Data,Summary,Stocks,SGD,D05,100,1,35.5',
    'Open Positions,Data,Summary,Forex,USD,USD,5000,1,1',
    'Open Positions,Data,Summary,Stocks,USD,AAPL,10,1,180',
  ].join('\n');
  const rows = parseCsv(csv);
  assert.deepEqual(rows.map((r) => [r.symbol, r.quantity, r.price]), [['D05.SI', 100, 35.5], ['AAPL', 10, 180]]);
});

test('parseIbkrDividends reads the Dividends section only', () => {
  const csv = [
    'Dividends,Header,Currency,Date,Description,Amount',
    'Dividends,Data,USD,2025-05-15,AAPL(US0378331005) Cash Dividend USD 0.26 per Share (Ordinary Dividend),2.60',
    'Dividends,Data,Total,,,2.60',
  ].join('\n');
  assert.deepEqual(parseIbkrDividends(csv), [{ symbol: 'AAPL', date: '2025-05-15', amount: 2.6, currency: 'USD' }]);
});
