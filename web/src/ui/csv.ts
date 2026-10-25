// CSV export helpers, ported from public/app.js S32 csvCell. Cells that start
// with = + - @ are prefixed with ' so spreadsheets don't run them as formulas.
export function csvCell(v: unknown): string {
  if (typeof v === 'number') return String(v);
  const s = v == null ? '' : String(v);
  return /[",\n]/.test(s) || /^[=+\-@]/.test(s) ? '"' + s.replace(/"/g, '""').replace(/^([=+\-@])/, "'$1") + '"' : s;
}
export const toCsv = (rows: unknown[][]) => rows.map((r) => r.map(csvCell).join(',')).join('\n');
export function downloadCsv(name: string, csv: string): void {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
  a.download = name; a.click(); URL.revokeObjectURL(a.href);
}
