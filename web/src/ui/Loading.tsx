import type { ReactNode } from 'react';
import styles from './primitives.module.css';
export function Loading({ children = 'Loading…' }: { children?: ReactNode }) { return <div role="status" className={styles.empty}>{children}</div>; }
