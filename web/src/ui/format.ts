// Ported verbatim from public/app.js formatting helpers; values are not normalised.
export type Numeric = number | null | undefined;
export const fmt = (n: Numeric, d = 2) => (n == null || Number.isNaN(n)) ? '—'
  : Number(n).toLocaleString(undefined, { minimumFractionDigits: d, maximumFractionDigits: d });
export const fmtBig = (n: Numeric): string => {
  if (n == null || Number.isNaN(n)) return '—';
  const a = Math.abs(n);
  if (a >= 1e12) return (n / 1e12).toFixed(2) + 'T';
  if (a >= 1e9) return (n / 1e9).toFixed(2) + 'B';
  if (a >= 1e6) return (n / 1e6).toFixed(2) + 'M';
  if (a >= 1e3) return (n / 1e3).toFixed(2) + 'K';
  return fmt(n);
};
export const signClass = (n: Numeric) => n != null && n > 0 ? 'up' : n != null && n < 0 ? 'down' : '';
export const signStr = (n: Numeric, d = 2) => (n == null ? '—' : (n > 0 ? '+' : '') + fmt(n, d));
const CCY_SYM: Record<string, string> = { USD: '$', SGD: 'S$', EUR: '€', GBP: '£', JPY: '¥', HKD: 'HK$', AUD: 'A$', CNY: '¥', INR: '₹', CAD: 'C$', CHF: 'CHF ' };
export const csym = (c?: string | null) => CCY_SYM[(c || '').toUpperCase()] || ((c || '') + ' ');
export const money = (c: string, n: Numeric, d = 2) => (n == null || Number.isNaN(n)) ? '—' : csym(c) + fmt(n, d);
export const moneyBig = (c: string, n: Numeric) => (n == null || Number.isNaN(n)) ? '—' : csym(c) + fmtBig(n);
export const moneySigned = (c: string, n: Numeric, d = 2) => (n == null || Number.isNaN(n)) ? '—' : (n < 0 ? '-' : '+') + csym(c) + fmt(Math.abs(n), d);
