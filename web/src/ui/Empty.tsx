import type { ReactNode } from 'react';
import styles from './primitives.module.css';
export function Empty({ children = 'No data.' }: { children?: ReactNode }) { return <div className={styles.empty}>{children}</div>; }
