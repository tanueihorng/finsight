import { useStore } from 'zustand';
import { money, moneySigned, moneyBig, type Numeric } from './format.ts';
import styles from './primitives.module.css';
import type {} from '../bootstrap.ts';
export function Money({ value, currency, decimals = 2, signed = false, compact = false, sensitive = true }: {
  value: Numeric; currency?: string; decimals?: number; signed?: boolean; compact?: boolean; sensitive?: boolean;
}) {
  const base = useStore(window.FinSight.store, (s) => s.base);
  const peek = useStore(window.FinSight.store, (s) => s.peek);
  const ccy = currency ?? base;
  const text = signed ? moneySigned(ccy, value, decimals) : compact ? moneyBig(ccy, value) : money(ccy, value, decimals);
  return <span className={sensitive && !peek ? styles.privateValue : undefined}>{text}</span>;
}
