import { useStore } from 'zustand';
import { fmt, type Numeric } from './format.ts';
import styles from './primitives.module.css';
import type {} from '../bootstrap.ts';
export function Num({ value, decimals = 2, sensitive = true }: { value: Numeric; decimals?: number; sensitive?: boolean }) {
  const peek = useStore(window.FinSight.store, (s) => s.peek);
  return <span className={sensitive && !peek ? styles.privateValue : undefined}>{fmt(value, decimals)}</span>;
}
