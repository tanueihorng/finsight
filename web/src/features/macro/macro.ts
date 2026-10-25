export const INFL_GAUGES = [
  { s: 'CPIAUCSL', t: 'pc1', name: 'CPI (headline)', src: 'BLS' },
  { s: 'CPILFESL', t: 'pc1', name: 'Core CPI', src: 'BLS' },
  { s: 'PCEPI', t: 'pc1', name: 'PCE (headline)', src: 'BEA · Fed 2% target' },
  { s: 'PCEPILFE', t: 'pc1', name: 'Core PCE', src: 'BEA' },
  { s: 'PCETRIM12M159SFRBDAL', t: 'lin', name: '★ Trimmed Mean PCE', src: 'Dallas Fed' },
  { s: 'MEDCPIM159SFRBCLE', t: 'lin', name: '★ Median CPI', src: 'Cleveland Fed' },
  { s: 'TRMMEANCPIM159SFRBCLE', t: 'lin', name: '★ Trimmed Mean CPI', src: 'Cleveland Fed' },
];
export function inflClass(v: number) {
  const d = v - 2.0;
  if (d <= 0.3) return 'up';
  if (d <= 1.0) return 'warn';
  return 'down';
}
