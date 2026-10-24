import { signClass, signStr, type Numeric } from './format.ts';
export function Pct({ value, decimals = 2 }: { value: Numeric; decimals?: number }) {
  return <span className={signClass(value)}>{signStr(value, decimals)}%</span>;
}
