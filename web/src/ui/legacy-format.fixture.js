// Frozen reference: the formatting helpers from public/app.js at 063115c, the
// last commit before X1 deleted app.js. ui/format.ts must keep matching them.
const fmt = (n, d = 2) => (n == null || Number.isNaN(n)) ? '—'
  : Number(n).toLocaleString(undefined, { minimumFractionDigits: d, maximumFractionDigits: d });
const fmtBig = (n) => {
  if (n == null || Number.isNaN(n)) return '—';
  const a = Math.abs(n);
  if (a >= 1e12) return (n / 1e12).toFixed(2) + 'T';
  if (a >= 1e9)  return (n / 1e9).toFixed(2) + 'B';
  if (a >= 1e6)  return (n / 1e6).toFixed(2) + 'M';
  if (a >= 1e3)  return (n / 1e3).toFixed(2) + 'K';
  return fmt(n);
};
const signClass = (n) => n > 0 ? 'up' : n < 0 ? 'down' : '';
const signStr = (n, d = 2) => (n == null ? '—' : (n > 0 ? '+' : '') + fmt(n, d));

// ---- currency formatting ----
const CCY_SYM = { USD: '$', SGD: 'S$', EUR: '€', GBP: '£', JPY: '¥', HKD: 'HK$', AUD: 'A$', CNY: '¥', INR: '₹', CAD: 'C$', CHF: 'CHF ' };
const csym = (c) => CCY_SYM[(c || '').toUpperCase()] || ((c || '') + ' ');
const money = (c, n, d = 2) => (n == null || Number.isNaN(n)) ? '—' : csym(c) + fmt(n, d);
const moneyBig = (c, n) => (n == null || Number.isNaN(n)) ? '—' : csym(c) + fmtBig(n);
const moneySigned = (c, n, d = 2) => (n == null || Number.isNaN(n)) ? '—' : (n < 0 ? '-' : '+') + csym(c) + fmt(Math.abs(n), d);

