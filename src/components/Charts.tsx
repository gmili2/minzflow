import { useState } from 'react';
import { dh0, kfmt } from '../lib/format';

function smooth(pts: [number, number][]) {
  if (!pts.length) return '';
  let d = `M${pts[0][0]} ${pts[0][1]}`;
  for (let i = 1; i < pts.length; i++) {
    const mx = (pts[i - 1][0] + pts[i][0]) / 2;
    d += ` C${mx} ${pts[i - 1][1]} ${mx} ${pts[i][1]} ${pts[i][0]} ${pts[i][1]}`;
  }
  return d;
}
function niceMax(v: number) {
  if (v <= 0) return 100000;
  const p = Math.pow(10, Math.floor(Math.log10(v)));
  const steps = [1, 2, 2.5, 5, 10];
  for (const s of steps) if (v * 1.1 <= s * p) return s * p;
  return 10 * p;
}

/** Mini courbe des cartes KPI. */
export function Spark({ series, color }: { series: number[]; color: string }) {
  const mx = Math.max(...series), mn = Math.min(...series), rng = mx - mn || 1;
  const step = series.length > 1 ? 130 / (series.length - 1) : 0;
  const pts = series.map((v, i) => [Math.round(i * step), Math.round(44 - ((v - mn) / rng) * 30)] as [number, number]);
  const line = smooth(pts);
  return (
    <svg className="spark" viewBox="0 0 130 48" aria-hidden="true">
      <path d={line + ' L130 48 L0 48 Z'} fill={color} opacity=".14" />
      <path d={line} fill="none" stroke={color} strokeWidth="2.2" />
    </svg>
  );
}

/** Courbes CA / dépenses (comme la maquette), avec info-bulle au survol. */
export function LineChart({ labels, longLabels, a, b, aLabel, bLabel }: { labels: string[]; longLabels: string[]; a: number[]; b: number[]; aLabel: string; bLabel: string }) {
  const [hv, setHv] = useState<number | null>(labels.length - 1);
  const W = 640, H = 260, pl = 48, pr = 20, pt = 18, pb = 36, base = H - pb;
  const n = labels.length;
  const maxY = niceMax(Math.max(...a, ...b, 100000));
  const xs = labels.map((_, i) => pl + (n > 1 ? (i * (W - pl - pr)) / (n - 1) : 0));
  const yOf = (v: number) => pt + (1 - v / maxY) * (H - pt - pb);
  const ap = a.map((v, i) => [xs[i], Math.round(yOf(v))] as [number, number]);
  const bp = b.map((v, i) => [xs[i], Math.round(yOf(v))] as [number, number]);
  let grid = '';
  const ylab: { top: string; label: string }[] = [];
  for (let g = 0; g <= 5; g++) {
    const gv = (maxY * g) / 5, gy = yOf(gv);
    grid += `M${pl} ${gy} H${W - pr} `;
    ylab.push({ top: (gy / H) * 100 + '%', label: kfmt(gv) });
  }
  xs.forEach((x) => { grid += `M${x} ${pt} V${base} `; });
  const al = smooth(ap), bl = smooth(bp);
  return (
    <div className="chart" onMouseLeave={() => setHv(n - 1)}>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`${aLabel} et ${bLabel} par mois`}>
        <path className="gl" d={grid} strokeWidth="1" fill="none" />
        <path d={`${al} L${xs[n - 1]} ${base} L${xs[0]} ${base} Z`} fill="#10B981" opacity=".12" />
        <path d={`${bl} L${xs[n - 1]} ${base} L${xs[0]} ${base} Z`} fill="#2F80ED" opacity=".1" />
        <path d={al} fill="none" stroke="#10B981" strokeWidth="3" />
        <path d={bl} fill="none" stroke="#2F80ED" strokeWidth="3" />
        {hv != null && <path d={`M${xs[hv]} ${pt} V${base}`} stroke="var(--muted)" strokeDasharray="3 3" />}
        {ap.map((p, i) => <circle key={'a' + i} cx={p[0]} cy={p[1]} r="4.5" fill="#10B981" className="halo" strokeWidth="2" />)}
        {bp.map((p, i) => <circle key={'b' + i} cx={p[0]} cy={p[1]} r="4.5" fill="#2F80ED" className="halo" strokeWidth="2" />)}
      </svg>
      {ylab.map((y, i) => <span key={i} className="ylab" style={{ top: y.top }}>{y.label}</span>)}
      {labels.map((l, i) => (
        <span key={i}>
          <span className="xlab" style={{ left: (xs[i] / W) * 100 + '%' }}>{l}</span>
          <button className="hcol" style={{ left: (xs[i] / W) * 100 + '%' }} onMouseEnter={() => setHv(i)} onFocus={() => setHv(i)} aria-label={`${longLabels[i]} : ${aLabel} ${dh0(a[i])}, ${bLabel} ${dh0(b[i])}`} />
        </span>
      ))}
      {hv != null && (
        <div className="tip" style={{ left: Math.min(Math.max((xs[hv] / W) * 100, 16), 84) + '%', top: (Math.min(ap[hv][1], bp[hv][1]) / H) * 100 + '%' }}>
          <b>{longLabels[hv]}</b><br />
          <span className="dot" style={{ background: '#10B981' }} />{aLabel} : <b>{dh0(a[hv])}</b><br />
          <span className="dot" style={{ background: '#2F80ED' }} />{bLabel} : <b>{dh0(b[hv])}</b>
        </div>
      )}
    </div>
  );
}

export const PALETTE = ['#2F80ED', '#10B981', '#8B5CF6', '#F59E0B', '#EF4444', '#14B8A6', '#EC4899', '#64748B'];

export function Donut({ items, total }: { items: { label: string; value: number }[]; total: number }) {
  const R = 80, C = 2 * Math.PI * R;
  let off = 0;
  return (
    <div className="donut-wrap">
      <div className="donut">
        <svg viewBox="0 0 200 200" width="200" height="200" role="img" aria-label="Répartition des charges">
          <circle cx="100" cy="100" r={R} fill="none" className="track" strokeWidth="30" />
          {total > 0 && items.map((it, i) => {
            const len = (it.value / total) * C;
            const el = <circle key={i} cx="100" cy="100" r={R} fill="none" stroke={PALETTE[i % PALETTE.length]} strokeWidth="30" strokeDasharray={`${Math.max(0, len - 2)} ${C}`} strokeDashoffset={-off} transform="rotate(-90 100 100)" />;
            off += len;
            return el;
          })}
        </svg>
        <div className="donut-c"><b style={{ fontSize: 19 }}>{dh0(total)}</b><span className="muted" style={{ fontSize: 13 }}>Total</span></div>
      </div>
      <div className="leg-rows">
        {items.length ? items.slice(0, 7).map((it, i) => (
          <div key={it.label} className="leg-row"><span><span className="dot" style={{ background: PALETTE[i % PALETTE.length] }} />{it.label}</span><b>{total ? Math.round((it.value / total) * 100) : 0}%</b></div>
        )) : <span className="muted">Aucune charge sur la période</span>}
      </div>
    </div>
  );
}

/** Barres groupées (bilan) : deux séries par mois. */
export function Bars({ labels, a, b, aLabel, bLabel }: { labels: string[]; a: number[]; b: number[]; aLabel: string; bLabel: string }) {
  const W = 640, H = 220, base = 190, max = Math.max(...a, ...b, 1);
  const slot = (W - 20) / Math.max(1, labels.length);
  const bw = Math.min(22, slot / 3);
  return (
    <div className="chart">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`${aLabel} et ${bLabel} par mois`}>
        <path className="gl" d={`M10 ${base} H${W - 10}`} />
        {labels.map((l, i) => {
          const cx = 10 + slot * i + slot / 2, ha = (a[i] / max) * 170, hb = (b[i] / max) * 170;
          return (
            <g key={i}>
              <rect x={cx - bw - 1} y={base - ha} width={bw} height={ha} rx="3" fill="#10B981"><title>{`${l} — ${aLabel} : ${dh0(a[i])}`}</title></rect>
              <rect x={cx + 1} y={base - hb} width={bw} height={hb} rx="3" fill="#2F80ED"><title>{`${l} — ${bLabel} : ${dh0(b[i])}`}</title></rect>
              <text x={cx} y={base + 18} textAnchor="middle" fontSize="12" fill="var(--text2)">{l}</text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}
