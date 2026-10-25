import test from 'node:test';
import assert from 'node:assert/strict';
import { csvCell, toCsv } from './csv.ts';

test('csvCell neutralises spreadsheet formulas like legacy', () => {
  assert.deepEqual(['=1+1', '+SUM(A1)', '-2', '@x', 'a,b', 'say "hi"', 5, null].map(csvCell),
    [`"'=1+1"`, `"'+SUM(A1)"`, `"'-2"`, `"'@x"`, '"a,b"', '"say ""hi"""', '5', '']);
  assert.equal(toCsv([['a', 1], ['b', -1]]), 'a,1\nb,-1'); // numbers are never prefixed
});
