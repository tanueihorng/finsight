import { useState } from 'react';
import { useStore } from 'zustand';
import { useAccounts, useExposure } from '../../api/queries.ts';
import { book } from '../paper/book.ts';
import { PanelHeadSlot } from '../../ui/PanelHeadSlot.tsx';
import { Empty } from '../../ui/Empty.tsx';
import { ErrorLine } from '../../ui/ErrorLine.tsx';
import { fmt } from '../../ui/format.ts';
import { shockImpact, type ExposureReport, type IssuerExposure } from '../../../../shared/lookthrough.ts';
import { denominator, inScope, segments, share, sources, unmappedGroups, UNMAPPED_COLOR, type Basis, type Source } from './exposure.ts';
import styles from './Exposure.module.css';

// ETF look-through (FEAT-018): each issuer's combined exposure as one bar,
// split by where it comes from (direct, then each fund). Click a bar for the
// contributing funds, their holdings dates, and a one-issuer what-if.
const TOP = 12;
const pct = (x: number, d = 1) => `${fmt(x * 100, d)}%`;
const amt = (x: number) => fmt(x, 0);

export default function ExposureIsland() {
  const q = useExposure();
  const accounts = useAccounts();
  const account = useStore(window.FinSight.store, (s) => s.account);
  const base = useStore(window.FinSight.store, (s) => s.base);
  const scope = { account, base };
  const shown = useStore(book, (s) => s.book);
  const [basis, setBasis] = useState<Basis>('invested');
  const [all, setAll] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  const head = (
    <PanelHeadSlot island="exposure">
      <div className="ranges" id="exposure-basis" role="group" aria-label="Percentages of">
        {([['invested', 'INVESTED'], ['networth', 'NET WORTH']] as const).map(([b, l]) =>
          <button key={b} aria-pressed={basis === b} className={basis === b ? 'active' : ''} onClick={() => setBasis(b)}>{l}</button>)}
      </div>
    </PanelHeadSlot>
  );
  const r = q.data;
  if (q.isError) return <>{head}<ErrorLine>Couldn't load look-through: {String((q.error as Error)?.message || q.error)}</ErrorLine></>;
  // A response for another account, base or book is never drawn.
  // Not <Loading />: its text is what H1 treats as a Suspense fallback.
  if (!inScope(r, { book: shown, account: scope.account, base: scope.base })) return <>{head}<span className="muted">Looking through fund holdings…</span></>;
  const rep = r!;
  const name = accounts.data?.accounts.find((a) => a.id === rep.account)?.name || (rep.account === 'ALL' ? 'All accounts' : rep.account);
  const scopeLine = <div className={styles.scope} data-testid="exposure-scope">{rep.book.toUpperCase()} · {name} · {rep.base} · as of {rep.asOf}</div>;
  if (!rep.basis) return <>{head}{scopeLine}<Empty>Add positions to see issuer exposure.</Empty></>;

  const src = sources(rep);
  const denom = denominator(rep, basis);
  const list = all ? rep.issuers : rep.issuers.slice(0, TOP);
  const max = rep.issuers[0]?.combined ?? 0;
  const groups = unmappedGroups(rep);
  const selected = rep.issuers.find((e) => e.issuer === open) ?? null;
  return (
    <>
      {head}
      {scopeLine}
      <Coverage rep={rep} denom={denom} basis={basis} />
      <Legend src={src} />
      {!rep.issuers.length && <Empty>No fund holdings are mapped yet. Add dated holdings files to the data folder's etf-holdings/.</Empty>}
      <ul className={styles.bars} aria-label="Exposure by issuer">
        {list.map((e) => (
          <li key={e.issuer}>
            <button type="button" className={styles.row + (open === e.issuer ? ' ' + styles.on : '')} aria-expanded={open === e.issuer}
              data-issuer={e.issuer} onClick={() => setOpen(open === e.issuer ? null : e.issuer)}>
              <span className={styles.sym} title={e.name}>{e.issuer}</span>
              <span className={styles.track} aria-hidden="true">
                {segments(e, max, src).map((s) => <i key={s.key} style={{ width: `${s.width}%`, background: s.color }} title={`${s.key === 'DIRECT' ? 'Direct' : 'via ' + s.key}: ${amt(s.value)}`} />)}
              </span>
              <span className={styles.val}>{amt(e.combined)}</span>
              <span className={styles.pct}>{pct(share(e.combined, denom))}</span>
            </button>
            {selected?.issuer === e.issuer && <Detail rep={rep} e={e} src={src} denom={denom} basis={basis} />}
          </li>
        ))}
      </ul>
      {rep.issuers.length > TOP && <button type="button" className={'mini-btn ' + styles.more} onClick={() => setAll(!all)}>{all ? `TOP ${TOP}` : `ALL ${rep.issuers.length}`}</button>}
      <div className={styles.unmapped} data-testid="exposure-unmapped">
        <div className={styles.h}>NOT BROKEN DOWN · {amt(rep.unmapped)} · {pct(share(rep.unmapped, denom))}</div>
        {groups.map((g) => (
          <div key={g.reason} className={styles.ug}>
            <span>{g.label}</span><span className={styles.val}>{amt(g.value)}</span>
            <span className={styles.ud}>{g.rows.map((x) => `${x.position}${x.holdingsDate ? ` (${x.holdingsDate})` : ''}: ${x.detail}`).join(' · ')}</span>
          </div>
        ))}
        {basis === 'networth' && rep.cash !== 0 && <div className={styles.ug}><span>Cash (not invested)</span><span className={styles.val}>{amt(rep.cash)}</span><span className={styles.ud}>counted in net worth only</span></div>}
        {rep.fileErrors.map((f) => <div key={f.file} className={styles.bad}>Unreadable holdings file {f.file}: {f.error}</div>)}
        {(rep.fxMissing?.length ?? 0) > 0 && (
          <div className={styles.bad} data-testid="exposure-fx-missing">
            No exchange rate for {rep.fxMissing.join(', ')} to {rep.base}. Left out of every figure above: {rep.unvalued.map((x) => `${x.item} ${x.currency} ${x.amount.toLocaleString()}`).join(' · ')}
          </div>
        )}
      </div>
    </>
  );
}

function Coverage({ rep, denom, basis }: { rep: ExposureReport; denom: number; basis: Basis }) {
  const m = share(rep.mapped, rep.basis);
  return (
    <div className={styles.cov}>
      <div className={styles.covLine}>
        <span>Mapped <b>{amt(rep.mapped)}</b> + not broken down <b>{amt(rep.unmapped)}</b> = <b>{amt(rep.mapped + rep.unmapped)}</b> invested</span>
        {rep.reconciles
          ? <span className={styles.ok} data-testid="exposure-reconciles">✓ reconciles</span>
          : <span className={styles.bad} data-testid="exposure-reconciles">✗ off by {fmt(rep.difference, 2)}</span>}
      </div>
      <div className={styles.covBar} aria-label={`${pct(m)} of invested value mapped to issuers`} role="img">
        <i style={{ width: `${m * 100}%`, background: 'var(--cyan)' }} /><i style={{ width: `${(1 - m) * 100}%`, background: UNMAPPED_COLOR }} />
      </div>
      {basis === 'networth' && <div className={styles.note}>Percentages of net worth {amt(denom)} (invested plus cash).</div>}
    </div>
  );
}

function Legend({ src }: { src: Source[] }) {
  return (
    <div className={styles.legend} data-testid="exposure-legend">
      {src.map((s) => (
        <span key={s.key} className={styles.lg} title={s.note || undefined}>
          <i style={{ background: s.color }} />{s.label}
          {s.status === 'expanded' && <span className={styles.date}>{s.holdingsDate}</span>}
          {s.status === 'stale' && <span className={styles.warn}>stale {s.holdingsDate}</span>}
          {s.status === 'missing' && <span className={styles.warn}>no file</span>}
          {s.status === 'invalid' && <span className={styles.warn}>invalid file</span>}
        </span>
      ))}
    </div>
  );
}

function Detail({ rep, e, src, denom, basis }: { rep: ExposureReport; e: IssuerExposure; src: Source[]; denom: number; basis: Basis }) {
  const [drop, setDrop] = useState(20);
  const color = new Map(src.map((s) => [s.key, s.color]));
  const shock = shockImpact(rep, e.issuer, drop);
  return (
    <div className={styles.detail} data-testid="exposure-detail">
      <div className={styles.dname}>{e.name}{e.tickers.length > 1 && <span className={styles.date}>{e.tickers.join(' + ')}</span>}</div>
      <table className={styles.ct}>
        <thead><tr><th>SOURCE</th><th>WEIGHT</th><th>HOLDINGS DATE</th><th>{rep.base}</th></tr></thead>
        <tbody>
          {e.contributions.map((c) => (
            <tr key={c.via}>
              <td><i className={styles.sw} style={{ background: color.get(c.via) }} />{c.kind === 'direct' ? 'Direct holding' : `via ${c.via}`}{c.tickers.length > 1 && <span className={styles.date}>{c.tickers.join(' + ')}</span>}</td>
              <td>{c.weightPct == null ? '—' : `${fmt(c.weightPct, 2)}%`}</td>
              <td>{c.holdingsDate ?? '—'}</td>
              <td>{amt(c.value)}</td>
            </tr>
          ))}
          <tr className={styles.tot}><td>Combined</td><td></td><td></td><td>{amt(e.combined)}</td></tr>
        </tbody>
      </table>
      <div className={styles.shock}>
        <label htmlFor={`shock-${e.issuer}`}>IF {e.issuer} FALLS</label>
        <input id={`shock-${e.issuer}`} type="range" min={0} max={100} step={1} value={drop} disabled={!rep.reconciles}
          onChange={(ev) => setDrop(Number(ev.target.value))} aria-valuetext={`${drop}%`} />
        <output htmlFor={`shock-${e.issuer}`} data-testid="exposure-shock">
          {rep.reconciles && shock
            ? <><b>{drop}%</b> → <span className="down">−{amt(-shock.impact)}</span> (−{pct(share(-shock.impact, denom), 2)} of {basis === 'networth' ? 'net worth' : 'invested'})</>
            : 'Totals do not reconcile; what-if is off.'}
        </output>
      </div>
      {rep.reconciles && shock && (
        <div className={styles.note}>
          Estimate on mapped exposure only ({pct(shock.coverage)} of invested). Assumes fund weights stay as of their holdings dates and everything else, including the {amt(rep.unmapped)} not broken down, is unchanged.
        </div>
      )}
    </div>
  );
}
