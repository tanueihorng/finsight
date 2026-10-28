// Versioned lens catalog shared by server validation and the composer.
export const LENS_IDS = ['balanced', 'growth', 'speculative', 'hedge-fund', 'macro'] as const;
export type LensId = typeof LENS_IDS[number];
export type Lens = Readonly<{ id: LensId; version: 1; label: string; priorities: readonly string[]; limitations: readonly string[] }>;
export const LENSES: readonly Lens[] = [
  { id: 'balanced', version: 1, label: 'Balanced', priorities: ['capital preservation', 'concentration', 'downside', 'policy fit'], limitations: ['Missing policy is not permission to assume one.'] },
  { id: 'growth', version: 1, label: 'Growth', priorities: ['business quality', 'growth durability', 'unit economics', 'reinvestment', 'valuation expectations'], limitations: ['Growth does not establish suitability.'] },
  { id: 'speculative', version: 1, label: 'Speculative / Catalyst', priorities: ['catalysts', 'payoff scenarios', 'dilution', 'liquidity', 'permanent loss', 'invalidation'], limitations: ['Do not assume leverage or stop rules.'] },
  { id: 'hedge-fund', version: 1, label: 'Hedge Fund', priorities: ['variant perception', 'catalysts', 'downside', 'positioning', 'hedging evidence'], limitations: ['No privileged access; disclose missing positioning data.'] },
  { id: 'macro', version: 1, label: 'Macro', priorities: ['inflation', 'employment', 'credit', 'liquidity', 'policy transmission', 'alternative scenarios'], limitations: ['Tie macro evidence to the question.'] },
];
