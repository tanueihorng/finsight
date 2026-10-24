import type { ReactNode } from 'react';
import styles from './primitives.module.css';
export function ErrorLine({ children }: { children: ReactNode }) { return <div role="alert" className={styles.error}>{children}</div>; }
