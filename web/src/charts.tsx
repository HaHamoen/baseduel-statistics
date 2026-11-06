// One line chart, drawn as SVG, for every chart on the site. The specs are
// the data-viz method's: 2px lines, solid hairline grid, >= 8px markers with
// a 2px surface ring, a legend for two or more series with line keys, labels
// only at the line ends, text in text colours (never the series colour), and
// a crosshair that snaps to the nearest point with one tooltip for every
// series. Keyboard: focus the chart, then the arrow keys move the crosshair.

import type { ComponentChildren } from "preact";
import { useEffect, useRef, useState } from "preact/hooks";

export interface Series {
  id: string;
  label: string;
  /** "viz-a" / "viz-b" (the team colours) or "viz-1" (a single series). */
  cls: string;
  /** One value per x position; null leaves a gap. */
  values: (number | null)[];
  /** Pixels to draw the line off its value: two step lines that tie for
   * a stretch sit side by side instead of one hiding the other. */
  dy?: number;
}

export interface TipRow {
  cls?: string;
  label: string;
  value: string;
}

export interface Tip {
  head: string;
  rows: TipRow[];
  note?: string;
}

interface Props {
  label: string;
  xs: number;
  series: Series[];
  /** Step after each point: the score holds until the next round ends it. */
  step?: boolean;
  yMax: number;
  yTicks: number[];
  yFmt: (v: number) => string;
  xTicks: number[];
  xFmt: (i: number) => string;
  reference?: { y: number; label: string };
  endLabel?: (s: Series, v: number) => string;
  tip: (i: number) => Tip;
  height?: number;
}

const M = { top: 12, right: 44, bottom: 26, left: 40 };
const TICK_GAP = 44;

export function LineChart(p: Props) {
  const box = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(640);
  const [hover, setHover] = useState<number | null>(null);
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setWidth(Math.max(260, e.contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const height = p.height ?? 220;
  // A reference line's label ("career 60%") sits right of the plot: leave it
  // room, or a phone cuts it off.
  const pw = width - M.left - (p.reference ? M.right + 36 : M.right);
  const ph = height - M.top - M.bottom;
  const x = (i: number) => M.left + (p.xs <= 1 ? pw / 2 : (i / (p.xs - 1)) * pw);
  const y = (v: number) => M.top + (1 - v / (p.yMax || 1)) * ph;

  const path = (vals: (number | null)[], dy = 0) => {
    let d = "";
    let prev: number | null = null;
    vals.forEach((v, i) => {
      if (v == null) { prev = null; return; }
      if (prev == null) d += `M${x(i)},${y(v) + dy}`;
      else if (p.step) d += `L${x(i)},${y(prev) + dy}L${x(i)},${y(v) + dy}`;
      else d += `L${x(i)},${y(v) + dy}`;
      prev = v;
    });
    return d;
  };

  const pick = (clientX: number) => {
    const rect = box.current!.getBoundingClientRect();
    const i = Math.round(((clientX - rect.left - M.left) / pw) * (p.xs - 1));
    setHover(Math.max(0, Math.min(p.xs - 1, i)));
  };

  // End labels: the last value of each series, once each, never on top of
  // each other.
  const ends = p.endLabel ? p.series.map((s) => {
    let i = s.values.length - 1;
    while (i >= 0 && s.values[i] == null) i--;
    return i < 0 ? null : { s, i, v: s.values[i]! };
  }).filter((e): e is { s: Series; i: number; v: number } => !!e) : [];
  const labelled = ends.filter((e, k) => !ends.slice(0, k).some((o) => Math.abs(y(o.v) - y(e.v)) < 14));

  const xTicks = spacedTicks(p.xTicks, x);

  const tip = hover == null ? null : p.tip(hover);
  const tipLeft = hover == null ? 0 : x(hover) + 14;
  const flip = hover != null && tipLeft + 190 > width;

  return (
    <div class="chart" ref={box}>
      {p.series.length > 1 && (
        <ul class="chart-legend">
          {p.series.map((s) => <li><span class={`key ${s.cls}`} aria-hidden="true" />{s.label}</li>)}
        </ul>
      )}
      <svg width={width} height={height} role="img" aria-label={p.label} tabIndex={0}
           onPointerMove={(e) => pick(e.clientX)} onPointerDown={(e) => pick(e.clientX)}
           onPointerLeave={() => setHover(null)}
           onFocus={() => setHover((h) => h ?? p.xs - 1)} onBlur={() => setHover(null)}
           onKeyDown={(e) => {
             if (e.key === "ArrowLeft") setHover((h) => Math.max(0, (h ?? p.xs - 1) - 1));
             else if (e.key === "ArrowRight") setHover((h) => Math.min(p.xs - 1, (h ?? 0) + 1));
             else return;
             e.preventDefault();
           }}>
        <g class="grid">
          {p.yTicks.map((t) => <line x1={M.left} x2={M.left + pw} y1={y(t)} y2={y(t)} />)}
        </g>
        <g class="ticks">
          {p.yTicks.map((t) => <text x={M.left - 8} y={y(t)} dy="0.32em" text-anchor="end">{p.yFmt(t)}</text>)}
          {xTicks.map((i) => <text x={x(i)} y={height - 6} text-anchor="middle">{p.xFmt(i)}</text>)}
        </g>
        {p.reference && (
          <g class="reference">
            <line x1={M.left} x2={M.left + pw} y1={y(p.reference.y)} y2={y(p.reference.y)} />
            <text x={M.left + pw + 6} y={y(p.reference.y)} dy="0.32em">{p.reference.label}</text>
          </g>
        )}
        {p.series.map((s) => <path class={`line ${s.cls}`} d={path(s.values, s.dy)} />)}
        {labelled.map((e) => (
          <text class="end-label" x={x(e.i) + 8} y={y(e.v)} dy="0.32em">{p.endLabel!(e.s, e.v)}</text>
        ))}
        {hover != null && (
          <g class="hover">
            <line class="crosshair" x1={x(hover)} x2={x(hover)} y1={M.top} y2={M.top + ph} />
            {p.series.map((s) => s.values[hover] == null ? null : (
              <circle class={`dot ${s.cls}`} cx={x(hover)} cy={y(s.values[hover]!) + (s.dy || 0)} r={4} />
            ))}
          </g>
        )}
      </svg>
      {tip && <TipBox tip={tip} style={flip ? { right: `${width - x(hover!) + 14}px` } : { left: `${tipLeft}px` }} />}
    </div>
  );
}

function TipBox({ tip, style }: { tip: Tip; style: Record<string, string> }) {
  return (
    <div class="chart-tip" style={style}>
      <div class="tip-head">{tip.head}</div>
      {tip.rows.map((r) => (
        <div class="tip-row">
          <strong>{r.value}</strong>
          {r.cls && <span class={`key ${r.cls}`} aria-hidden="true" />}
          <span>{r.label}</span>
        </div>
      ))}
      {tip.note && <div class="tip-note">{tip.note}</div>}
    </div>
  );
}

/** Ticks at least TICK_GAP apart at this width, the first and the last
 * always kept: a phone gets fewer labels, never overlapping ones. */
function spacedTicks(ticks: number[], x: (i: number) => number): number[] {
  const out: number[] = [];
  for (const i of [...ticks].sort((a, b) => a - b)) {
    if (!out.length || x(i) - x(out[out.length - 1]) >= TICK_GAP) out.push(i);
  }
  const last = Math.max(...ticks);
  if (out.length && out[out.length - 1] !== last) {
    if (out.length > 1 && x(last) - x(out[out.length - 1]) < TICK_GAP) out.pop();
    out.push(last);
  }
  return out;
}

interface BarProps {
  label: string;
  values: number[];
  yMax: number;
  yTicks: number[];
  yFmt: (v: number) => string;
  xTicks: number[];
  xFmt: (i: number) => string;
  tip: (i: number) => Tip;
  height?: number;
}

const BM = { top: 12, right: 12, bottom: 26, left: 40 };

/** One series of bars, one per x position: thin, 2px apart, the top end
 * rounded and the foot on the baseline. Hover or arrow keys pick a bar; its
 * whole column is the target. */
export function BarChart(p: BarProps) {
  const box = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(640);
  const [hover, setHover] = useState<number | null>(null);
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setWidth(Math.max(260, e.contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const n = p.values.length;
  const height = p.height ?? 200;
  const pw = width - BM.left - BM.right;
  const ph = height - BM.top - BM.bottom;
  const slot = pw / Math.max(1, n);
  // 2px apart, less once the bars are thinner than that.
  const bw = Math.max(1, Math.min(slot - Math.min(2, slot / 3), 22));
  const x = (i: number) => BM.left + (i + 0.5) * slot;
  const y = (v: number) => BM.top + (1 - v / (p.yMax || 1)) * ph;
  const base = BM.top + ph;
  const bar = (i: number, v: number) => {
    const h = base - y(v);
    const r = Math.min(4, bw / 2, h);
    const l = x(i) - bw / 2;
    return `M${l},${base}V${base - h + r}Q${l},${base - h} ${l + r},${base - h}H${l + bw - r}` +
      `Q${l + bw},${base - h} ${l + bw},${base - h + r}V${base}Z`;
  };
  const pick = (clientX: number) => {
    const rect = box.current!.getBoundingClientRect();
    setHover(Math.max(0, Math.min(n - 1, Math.floor((clientX - rect.left - BM.left) / slot))));
  };
  const tip = hover == null ? null : p.tip(hover);
  const tipLeft = hover == null ? 0 : x(hover) + bw / 2 + 10;
  const flip = hover != null && tipLeft + 190 > width;
  return (
    <div class="chart" ref={box}>
      <svg width={width} height={height} role="img" aria-label={p.label} tabIndex={0}
           onPointerMove={(e) => pick(e.clientX)} onPointerDown={(e) => pick(e.clientX)}
           onPointerLeave={() => setHover(null)}
           onFocus={() => setHover((h) => h ?? n - 1)} onBlur={() => setHover(null)}
           onKeyDown={(e) => {
             if (e.key === "ArrowLeft") setHover((h) => Math.max(0, (h ?? n - 1) - 1));
             else if (e.key === "ArrowRight") setHover((h) => Math.min(n - 1, (h ?? 0) + 1));
             else return;
             e.preventDefault();
           }}>
        <g class="grid">
          {p.yTicks.map((t) => <line x1={BM.left} x2={BM.left + pw} y1={y(t)} y2={y(t)} />)}
        </g>
        <g class="ticks">
          {p.yTicks.map((t) => <text x={BM.left - 8} y={y(t)} dy="0.32em" text-anchor="end">{p.yFmt(t)}</text>)}
          {spacedTicks(p.xTicks, x).map((i) => <text x={x(i)} y={height - 6} text-anchor="middle">{p.xFmt(i)}</text>)}
        </g>
        {hover != null && <rect class="bar-hover" x={x(hover) - slot / 2} y={BM.top} width={slot} height={ph} />}
        <g class="bars">
          {p.values.map((v, i) => (v > 0 ? <path class={hover === i ? "on" : undefined} d={bar(i, v)} /> : null))}
        </g>
      </svg>
      {tip && <TipBox tip={tip} style={flip ? { right: `${width - x(hover!) + bw / 2 + 10}px` } : { left: `${tipLeft}px` }} />}
    </div>
  );
}

/** Clean axis steps: 0 up to a round number at or above the top value. */
export function niceTicks(top: number, count = 4): { max: number; ticks: number[] } {
  if (top <= 0) return { max: 1, ticks: [0, 1] };
  const raw = top / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw)!;
  const max = Math.ceil(top / step - 1e-9) * step;
  const ticks: number[] = [];
  for (let t = 0; t <= max + 1e-9; t += step) ticks.push(Number(t.toFixed(10)));
  return { max, ticks };
}

export function ChartNote({ children }: { children: ComponentChildren }) {
  return <p class="chart-note">{children}</p>;
}
