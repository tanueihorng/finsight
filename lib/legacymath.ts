// Typed bridge to the browser's pure math files in public/ (classic UMD
// scripts, also loaded with require() by Node). public/package.json keeps them
// CommonJS for Node; the browser loads the same bytes as plain scripts.
import { createRequire } from 'node:module';
import type { HistoryPoint } from '../shared/types.ts';

const require = createRequire(import.meta.url);

/** A bar as the indicators read it (history points, or test fixtures). */
export type Bar = HistoryPoint;
/** Aligned to the input; null where the indicator is not yet defined. */
export type Series = (number | null)[];

/** The parts of public/indicators.js the server uses. */
export interface Indicators {
  rsi(bars: Bar[], n: number): Series;
  sma(values: number[], n: number): Series;
  ema(values: number[], n: number): Series;
  mfi(bars: Bar[], n: number): Series;
  cci(bars: Bar[], n: number): Series;
  willr(bars: Bar[], n: number): Series;
}

export const indicators = require('../public/indicators.js') as Indicators;
