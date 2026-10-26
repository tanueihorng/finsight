import { useEffect, useRef, useState, type CSSProperties, type PointerEvent } from 'react';

// The lock screen's "opening bell" stage: wordmark, a decorative candlestick
// chart with a pointer crosshair, and a boot log. All of it is aria-hidden;
// the PIN form beside it is the screen's real content.

// A seeded random walk, so the chart is identical on every launch and never
// looks like (or claims to be) real market data. Readouts are labelled SIM.
const CANDLES = (() => {
  let seed = 7, p = 60;
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  return Array.from({ length: 56 }, (_, i) => {
    const o = p; p = Math.max(18, Math.min(150, p + (rnd() - 0.42) * 14 + (i > 40 ? 1.6 : 0)));
    const c = p, hi = Math.max(o, c) + rnd() * 8, lo = Math.min(o, c) - rnd() * 8;
    return { o, c, hi, lo, v: 4 + ((i * 37) % 11) + Math.abs(c - o) * 0.8 };
  });
})();
const LADDER = 64; // px reserved on the right of the chart for the price ladder

function Skyline() {
  const w = 10, W = CANDLES.length * w, y = (v: number) => 170 - v;
  const pts = CANDLES.map((k, i) => `${i * w + 5},${y(k.c)}`);
  const last = CANDLES.at(-1)!, pct = (v: number) => `${(y(v) / 180) * 100}%`;
  return (
    <div className="sx-sky">
      {[140, 110, 80, 50].map((v) => <div key={v} className="sx-grid" style={{ top: pct(v) }}><span>{v.toFixed(2)}</span></div>)}
      <svg viewBox={`0 0 ${W} 180`} preserveAspectRatio="none">
        <defs>
          <linearGradient id="sx-area" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0" stopColor="var(--amber)" stopOpacity=".28" /><stop offset="1" stopColor="var(--amber)" stopOpacity="0" />
          </linearGradient>
        </defs>
        <path className="sx-area" d={`M5,180 L${pts.join(' L')} L${W - 5},180 Z`} fill="url(#sx-area)" />
        {CANDLES.map((k, i) => <rect key={`v${i}`} className="sx-vol" x={i * w + 2} y={180 - k.v} width={6} height={k.v} style={{ '--i': i } as CSSProperties} />)}
        {CANDLES.map((k, i) => (
          <g key={i} className={k.c >= k.o ? 'up' : 'dn'} style={{ '--i': i } as CSSProperties}>
            <line x1={i * w + 5} x2={i * w + 5} y1={y(k.hi)} y2={y(k.lo)} />
            <rect x={i * w + 2} y={y(Math.max(k.o, k.c))} width={6} height={Math.max(1.5, Math.abs(k.c - k.o))} />
          </g>
        ))}
        <polyline className="sx-trace" points={pts.join(' ')} />
      </svg>
      <div className="sx-last" style={{ top: pct(last.c) }}><span>{last.c.toFixed(2)}</span></div>
      <i className="sx-beacon" style={{ top: pct(last.c) }} />
    </div>
  );
}

export type BootLine = { text: string; ok?: boolean };

export function Stage({ boot }: { boot: BootLine[] }) {
  const ref = useRef<HTMLElement>(null);
  const [hit, setHit] = useState<{ i: number; x: number; y: number } | null>(null);
  const move = (e: PointerEvent) => {
    const el = ref.current; if (!el) return;
    const r = el.getBoundingClientRect(), px = e.clientX - r.left, py = e.clientY - r.top;
    el.style.setProperty('--mx', `${px}px`); el.style.setProperty('--my', `${py}px`);
    const sky = el.querySelector('.sx-sky')!.getBoundingClientRect();
    if (e.clientY < sky.top) return setHit(null); // crosshair only over the chart
    const cw = r.width - LADDER, i = Math.max(0, Math.min(CANDLES.length - 1, Math.floor((px / cw) * CANDLES.length)));
    setHit({ i, x: ((i + 0.5) / CANDLES.length) * cw, y: py });
  };
  const k = hit ? CANDLES[hit.i]! : null;
  return (
    <section className="sx-stage" ref={ref} aria-hidden="true" onPointerMove={move} onPointerLeave={() => setHit(null)}>
      <Skyline />
      <div className="sx-scan" />
      {hit && k && <>
        <div className="sx-xh-v" style={{ left: hit.x }} />
        <div className="sx-xh-h" style={{ top: hit.y }} />
        <div className={hit.i > CANDLES.length * 0.6 ? 'sx-xh-tip flip' : 'sx-xh-tip'} style={{ left: hit.x, top: hit.y }}>
          <b>SIM·{String(hit.i + 1).padStart(2, '0')}</b> O {k.o.toFixed(1)} H {k.hi.toFixed(1)} L {k.lo.toFixed(1)} C <em className={k.c >= k.o ? 'up' : 'dn'}>{k.c.toFixed(1)}</em>
        </div>
      </>}
      <div className="sx-copy">
        <span className="sx-eyebrow">PERSONAL TERMINAL · v1</span>
        <div className="sx-word"><span className="a">FIN</span><span className="b">SIGHT</span></div>
        <p className="sx-tag">A trading floor for one.<br />Running entirely on this machine.</p>
        <ol className="sx-boot">
          {boot.map((l, i) => <li key={l.text} className={l.ok ? 'ok' : ''} style={{ '--i': i } as CSSProperties}>{l.text}</li>)}
        </ol>
      </div>
    </section>
  );
}

// Ticks only while the lock screen is showing.
export function Clock() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => { if (document.body.classList.contains('locked')) setNow(new Date()); }, 1000);
    return () => clearInterval(t);
  }, []);
  return <span className="sx-clock">{now.toLocaleTimeString([], { hour12: false })}</span>;
}

const TAPE = ['LOCAL-FIRST', 'NO API KEYS', 'NO TRACKING', 'FX RISK', 'MACRO · FRED', 'DIVIDENDS', 'ALERTS', 'CSV IN / CSV OUT', 'YOUR DATA STAYS HERE'];
export function Tape() {
  return (
    <div className="sx-tape" aria-hidden="true">
      <div>{[...TAPE, ...TAPE].map((t, i) => <span key={i}>{t}<i>▲</i></span>)}</div>
    </div>
  );
}
