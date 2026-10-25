import { useEffect, useState } from 'react';
import { useStore } from 'zustand';
import { useNews } from '../../api/queries.ts';
import { PanelHeadSlot } from '../../ui/PanelHeadSlot.tsx';
import { timeAgo } from './news.ts';
import styles from './News.module.css';

export default function NewsIsland() {
  const selected = useStore(window.FinSight.store, (state) => state.selected);
  // NEWS with no argument requests market news without clearing the selected
  // security/detail. That override expires on the next selection, even if the
  // user reselects the same symbol (the legacy selector emits news-selected).
  const [marketFor, setMarketFor] = useState<string | null | undefined>(undefined);
  const market = marketFor !== undefined && marketFor === selected;
  const symbol = market ? '' : selected || '';
  const { data, dataUpdatedAt, isFetching, isError, error, refetch } = useNews(symbol);
  useEffect(() => { setMarketFor(undefined); }, [selected]);
  useEffect(() => {
    const bus = window.FinSight.bus;
    const selectedOff = bus.on('news-selected', () => {
      setMarketFor(undefined);
      // A changed selection will fetch with its new key; avoid also fetching
      // the old key while React processes the synchronous legacy store write.
      if (!market && window.FinSight.store.getState().selected === selected) return refetch();
    });
    const marketOff = bus.on('news-market', () => {
      const current = window.FinSight.store.getState().selected;
      setMarketFor(current);
      if (!symbol && current === selected) return refetch();
    });
    return () => { selectedOff(); marketOff(); };
  }, [selected, market, symbol, refetch]);

  const head = <PanelHeadSlot island="news">{symbol || 'market'}</PanelHeadSlot>;
  if (isFetching || (!data && !isError)) return <>{head}<span className="muted">Loading news…</span></>;
  if (isError) return <>{head}<span className="down">News error: {error.message}</span></>;
  if (!data?.news.length) return <>{head}<span className="muted">No headlines found.</span></>;
  // intended fix (A2): symbol-keyed queries and AbortSignal prevent a delayed
  // previous selection from overwriting the current security's headlines.
  return <>{head}{data.news.map((item, index) => <a className={`news-item ${styles.item}`} href={item.link} target="_blank" rel="noopener noreferrer" key={`${item.link}:${index}`}>
    <div className={`news-title ${styles.title}`}>{item.title}</div>
    <div className={`news-meta ${styles.meta}`}>{item.publisher || ''}{item.time ? ' · ' + timeAgo(item.time, dataUpdatedAt) : ''}</div>
  </a>)}</>;
}
