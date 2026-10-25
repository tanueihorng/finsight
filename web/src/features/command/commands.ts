// Command bar grammar (F7), ported 1:1 from public/app.js runCommand. Parsing
// only: runCommand.ts performs the writes. Commands are case-insensitive;
// symbols are sent as typed and shown upper-case, like legacy.
export const HELP = 'ADD <s> <qty> <px> [date] · SELL <s> <qty> [px] · DEL <s> · UNDO · LEDGER · CASH <ccy> <amt> · WHT <mkt> <%> · Q <s> · WATCH/UNWATCH <s> · ALERT <s> > <px> · NEWS [s] · MKT · CLEAR';
export const USAGE = {
  add: 'Usage: ADD <symbol> <qty> <avg price> [YYYY-MM-DD]   e.g. ADD AAPL 10 195.50',
  sell: 'Usage: SELL <symbol> <qty> [price]   (price optional → uses market)',
  del: 'Usage: DEL <symbol>', quote: 'Usage: Q <symbol>', watch: 'Usage: WATCH <symbol>', unwatch: 'Usage: UNWATCH <symbol>',
  alert: 'Usage: ALERT <symbol> > <price>   (use > or <)',
  cash: 'Usage: CASH <currency> <amount>   e.g. CASH USD 5000   (0 clears it)',
  wht: 'Usage: WHT <US|SG|HK|UK|EU|JP|AU|CA|OTHER> <percent>   e.g. WHT US 15',
} as const;

export type Command =
  | { kind: 'none' } | { kind: 'help' } | { kind: 'clear' } | { kind: 'usage'; msg: string }
  | { kind: 'add'; sym: string; qty: string; price: string; date: string | null }
  | { kind: 'sell'; sym: string; qty: string; price: string | null }
  | { kind: 'del'; sym: string } | { kind: 'quote'; sym: string }
  | { kind: 'watch'; sym: string } | { kind: 'unwatch'; sym: string }
  | { kind: 'alert'; sym: string; op: '<' | '>'; price: string }
  | { kind: 'news'; sym: string | null } | { kind: 'undo' } | { kind: 'ledger' }
  | { kind: 'cash'; ccy: string; amt: string } | { kind: 'wht'; mkt: string; pct: string } | { kind: 'markets' };

export function parseCommand(raw: string): Command {
  const text = raw.trim();
  if (!text) return { kind: 'none' };
  const parts = text.split(/\s+/);
  const cmd = parts[0]!.toUpperCase();
  const [, a, b, c, d] = parts;
  const usage = (msg: string): Command => ({ kind: 'usage', msg });
  switch (cmd) {
    case 'HELP': case '?': return { kind: 'help' };
    case 'ADD': case 'BUY': return a && b && c ? { kind: 'add', sym: a, qty: b, price: c, date: d || null } : usage(USAGE.add);
    case 'SELL': return a && b ? { kind: 'sell', sym: a, qty: b, price: c ?? null } : usage(USAGE.sell);
    case 'DEL': case 'DELETE': case 'REMOVE': return a ? { kind: 'del', sym: a } : usage(USAGE.del);
    case 'Q': case 'QUOTE': return a ? { kind: 'quote', sym: a.toUpperCase() } : usage(USAGE.quote);
    case 'WATCH': return a ? { kind: 'watch', sym: a } : usage(USAGE.watch);
    case 'UNWATCH': return a ? { kind: 'unwatch', sym: a } : usage(USAGE.unwatch);
    case 'ALERT':
      if (!a || !b || !c) return usage(USAGE.alert);
      return { kind: 'alert', sym: a, op: b.includes('<') || /below|under/i.test(b) ? '<' : '>', price: c };
    case 'NEWS': return { kind: 'news', sym: a ? a.toUpperCase() : null };
    case 'UNDO': return { kind: 'undo' };
    case 'LEDGER': case 'TRADES': return { kind: 'ledger' };
    case 'CASH': return a && b != null ? { kind: 'cash', ccy: a, amt: b } : usage(USAGE.cash);
    case 'WHT': return a && b != null ? { kind: 'wht', mkt: a, pct: b } : usage(USAGE.wht);
    case 'MKT': case 'MARKETS': return { kind: 'markets' };
    case 'CLEAR': return { kind: 'clear' };
    default: return { kind: 'quote', sym: cmd }; // a bare symbol quotes it
  }
}
