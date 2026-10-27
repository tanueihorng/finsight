// Fixed synthetic Phase 1 evaluation: no personal holdings, web or paid judges.
export type UiCase = { id: string; prompt: string; kind: 'stat_grid' | 'table' | 'price_chart' | 'exposure_chart' | 'text'; paired?: boolean };
const groups: { prefix: string; kind: UiCase['kind']; prompts: string[] }[] = [
  { prefix: 'portfolio', kind: 'stat_grid', prompts: [
    'Show my net worth, securities value and cash as snapshot cards.',
    'Give me a visual overview of net worth, cost and unrealized P/L.',
    'Show snapshot cards for securities value, realized P/L and unrealized P/L.',
    'Can I see a compact visual summary of my portfolio totals and number of positions?',
    'Put net worth, cash and the number of holdings into stat cards.',
  ] },
  { prefix: 'positions', kind: 'table', prompts: [
    'Compare my three largest positions in a table: symbol, market value and weight.',
    'Show a sortable table of my holdings with symbol, native last price and reporting-currency value.',
    'List my USD holdings in a table with symbol, quantity and average cost.',
    'Show my positions with symbol, unrealized P/L and unrealized percentage as a table.',
    'Put my top holdings in a table with symbol, weight and day change.',
  ] },
  { prefix: 'cash', kind: 'table', prompts: [
    'Show a cash table comparing currencies, native balances and reporting-currency values.',
    'Can I see my cash by currency as a sortable table?',
    'Compare native cash and base-currency cash values in a table with currency labels.',
    'Make a table showing each cash currency and its amount.',
  ] },
  { prefix: 'exposure', kind: 'table', prompts: [
    'Show a sector exposure table with group, value and portfolio weight.',
    'Compare my currency exposures in a table with weights.',
    'Show account exposure groups and values in a sortable table.',
    'Put sector names and exposure percentages into a table; retain the ETF caveat.',
  ] },
  { prefix: 'accounts', kind: 'table', prompts: [
    'Show my accounts in a table with names, types and position counts.',
    'Compare my brokerage and bank accounts as a table.',
    'Put account names and numbers of positions into a sortable table.',
  ] },
  { prefix: 'quotes', kind: 'table', prompts: [
    'Compare quotes for NVDA, VOO and D05.SI in a table with symbols and prices.',
    'Show a snapshot quote table for NVDA and VOO, keeping their currencies visible.',
    'Make a table of the latest quotes for D05.SI, NVDA and VOO.',
    'Compare NVDA and D05.SI prices in a sortable table rather than prose.',
  ] },
];
export const UI_CASES: UiCase[] = groups.flatMap((g) => g.prompts.map((prompt, i) => ({ id: `${g.prefix}-${i + 1}`, prompt, kind: g.kind, paired: i === 0 && g.prefix !== 'accounts' })));
const short = [
  'Hello! Reply with one short sentence.', 'What does net worth mean? Two sentences, no table.',
  'What is an ETF? Keep it brief.', 'Why can market prices be delayed? One sentence.',
  'What does unrealized profit mean? A short definition only.', 'Do you execute trades for me? Just answer briefly.',
  'What is the difference between native and reporting currency? Two sentences.',
  'Tell me my total cash as one number with its currency, no cards or table.',
  'How many accounts do I have? One number only.', 'What does diversification mean? One short paragraph.',
  'Can a past return guarantee a future return? A brief answer.', 'Explain a stock split in one sentence.',
  'What does a portfolio weight mean? One sentence.', 'What does missing quote data mean? Briefly explain.',
  'Thanks, that is all. Reply briefly.',
];
UI_CASES.push(...short.map((prompt, i): UiCase => ({ id: `text-${i + 1}`, prompt, kind: 'text' })));
export const median = (xs: number[]) => { const a = [...xs].sort((x, y) => x - y); const m = Math.floor(a.length / 2); return a.length ? (a.length % 2 ? a[m]! : (a[m - 1]! + a[m]!) / 2) : null; };

// Opt-in natural-language selection cases; synthetic facts only. This set does not confer model qualification.
export const NATURAL_UI_CASES: UiCase[] = [
  { id: 'natural-stock', prompt: 'Show me NVDA.', kind: 'price_chart' },
  { id: 'natural-concentration', prompt: 'Where is my portfolio concentrated?', kind: 'exposure_chart' },
  { id: 'natural-definition', prompt: 'What is an ETF? Give me a short text-only answer.', kind: 'text' },
  { id: 'natural-performance', prompt: 'How has VOO been doing over the last year?', kind: 'price_chart' },
  { id: 'natural-comparison', prompt: 'Compare my holdings by market value and weight.', kind: 'table' },
  { id: 'natural-explicit-table', prompt: 'Show my sector exposure as a table, not a chart.', kind: 'table' },
];
