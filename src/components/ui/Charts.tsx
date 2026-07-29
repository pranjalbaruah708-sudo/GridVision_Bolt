// SVG chart primitives — no external dependencies.
// All charts are purely declarative; they receive data as props and render SVG.

import type { ReactNode } from 'react';

// ─── colour palette ────────────────────────────────────────────────────────
export const STATION_COLORS = ['#1d52b4', '#f97316', '#ef4444', '#22c55e', '#a855f7', '#06b6d4'];
export const CAUSE_COLORS = ['#1d52b4', '#f97316', '#eab308', '#22c55e', '#6b7280'];

// ─── helpers ───────────────────────────────────────────────────────────────
function formatMW(v: number) {
  if (v >= 1000) return `${(v / 1000).toFixed(1)}k`;
  return String(Math.round(v));
}

// ─── Bar Chart (single series) ─────────────────────────────────────────────
// Used for Peak Load (MW) - Station / Utility
export type BarDatum = { label: string; value: number };

export function BarChart({
  data,
  color = '#1d52b4',
  unit = 'MW',
  height = 180,
}: {
  data: BarDatum[];
  color?: string;
  unit?: string;
  height?: number;
}) {
  const W = 320;
  const H = height;
  const padL = 36;
  const padR = 8;
  const padT = 10;
  const padB = 28;
  const chartW = W - padL - padR;
  const chartH = H - padT - padB;

  if (!data.length) return <div className="text-xs text-gray-400 py-4 text-center">No data</div>;

  const max = Math.max(...data.map((d) => d.value));
  const niceMax = Math.ceil(max / 50) * 50 || 100;
  const barW = chartW / data.length;
  const barGap = barW * 0.25;
  const barFill = barW - barGap;

  // Y-axis ticks
  const yTicks = [0, niceMax / 4, niceMax / 2, (niceMax * 3) / 4, niceMax].map(Math.round);

  // Show every Nth x-label so they don't overlap
  const step = data.length <= 10 ? 1 : Math.ceil(data.length / 6);

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ height }}>
      {/* Y grid + labels */}
      {yTicks.map((t) => {
        const y = padT + chartH - (t / niceMax) * chartH;
        return (
          <g key={t}>
            <line x1={padL} y1={y} x2={W - padR} y2={y} stroke="#e5e7eb" strokeWidth="1" />
            <text x={padL - 4} y={y + 4} textAnchor="end" fontSize="9" fill="#9ca3af">
              {formatMW(t)}
            </text>
          </g>
        );
      })}

      {/* Bars + X labels */}
      {data.map((d, i) => {
        const x = padL + i * barW + barGap / 2;
        const barH = (d.value / niceMax) * chartH;
        const y = padT + chartH - barH;
        return (
          <g key={i}>
            <rect x={x} y={y} width={barFill} height={barH} fill={color} rx="1" />
            {i % step === 0 && (
              <text
                x={x + barFill / 2}
                y={H - padB + 12}
                textAnchor="middle"
                fontSize="8"
                fill="#6b7280"
              >
                {d.label}
              </text>
            )}
          </g>
        );
      })}

      {/* Y-axis line */}
      <line x1={padL} y1={padT} x2={padL} y2={padT + chartH} stroke="#d1d5db" strokeWidth="1" />
    </svg>
  );
}

// ─── Grouped Bar Chart (multi-series) ──────────────────────────────────────
// Used for Interruptions (Number / Duration) by station per week
export type GroupedBarDatum = { label: string; values: number[] };

export function GroupedBarChart({
  data,
  series,
  colors = STATION_COLORS,
  height = 180,
  maxOverride,
}: {
  data: GroupedBarDatum[];
  series: string[];
  colors?: string[];
  height?: number;
  maxOverride?: number;
}) {
  const W = 320;
  const H = height;
  const padL = 28;
  const padR = 8;
  const padT = 10;
  const padB = 24;
  const chartW = W - padL - padR;
  const chartH = H - padT - padB;

  if (!data.length) return <div className="text-xs text-gray-400 py-4 text-center">No data</div>;

  const allVals = data.flatMap((d) => d.values);
  const max = maxOverride ?? Math.max(...allVals);
  const niceMax = Math.ceil(max / 10) * 10 || 10;

  const groupW = chartW / data.length;
  const nSeries = series.length;
  const barW = (groupW * 0.8) / nSeries;
  const groupGap = groupW * 0.2;

  const yTicks = [0, niceMax / 4, niceMax / 2, (niceMax * 3) / 4, niceMax].map(Math.round);

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ height }}>
      {yTicks.map((t) => {
        const y = padT + chartH - (t / niceMax) * chartH;
        return (
          <g key={t}>
            <line x1={padL} y1={y} x2={W - padR} y2={y} stroke="#e5e7eb" strokeWidth="1" />
            <text x={padL - 3} y={y + 3} textAnchor="end" fontSize="8" fill="#9ca3af">{t}</text>
          </g>
        );
      })}

      {data.map((group, gi) => {
        const groupX = padL + gi * groupW + groupGap / 2;
        return (
          <g key={gi}>
            {group.values.map((v, si) => {
              const bH = (v / niceMax) * chartH;
              const x = groupX + si * barW;
              const y = padT + chartH - bH;
              return (
                <rect key={si} x={x} y={y} width={barW - 1} height={bH} fill={colors[si % colors.length]} rx="1" />
              );
            })}
            <text
              x={groupX + (nSeries * barW) / 2}
              y={H - padB + 10}
              textAnchor="middle"
              fontSize="8"
              fill="#6b7280"
            >
              {group.label}
            </text>
          </g>
        );
      })}

      <line x1={padL} y1={padT} x2={padL} y2={padT + chartH} stroke="#d1d5db" strokeWidth="1" />
    </svg>
  );
}

// ─── Multi-line Chart ───────────────────────────────────────────────────────
// Used for Peak Load (MW) Comparison across stations
export type LineDatum = { label: string; values: number[] };

export function MultiLineChart({
  data,
  series,
  colors = STATION_COLORS,
  height = 200,
}: {
  data: LineDatum[];
  series: string[];
  colors?: string[];
  height?: number;
}) {
  const W = 320;
  const H = height;
  const padL = 40;
  const padR = 8;
  const padT = 10;
  const padB = 24;
  const chartW = W - padL - padR;
  const chartH = H - padT - padB;

  if (!data.length || !series.length) return null;

  const nPoints = data.length;
  const allVals = series.flatMap((_, si) => data.map((d) => d.values[si] ?? 0));
  const max = Math.max(...allVals);
  const niceMax = Math.ceil(max / 500) * 500 || 100;
  const yTicks = [0, niceMax / 4, niceMax / 2, (niceMax * 3) / 4, niceMax].map(Math.round);
  const step = nPoints <= 8 ? 1 : Math.ceil(nPoints / 6);

  const xForIdx = (i: number) => padL + (i / (nPoints - 1)) * chartW;
  const yForVal = (v: number) => padT + chartH - (v / niceMax) * chartH;

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ height }}>
      {yTicks.map((t) => {
        const y = yForVal(t);
        return (
          <g key={t}>
            <line x1={padL} y1={y} x2={W - padR} y2={y} stroke="#e5e7eb" strokeWidth="1" />
            <text x={padL - 4} y={y + 4} textAnchor="end" fontSize="9" fill="#9ca3af">
              {formatMW(t)}
            </text>
          </g>
        );
      })}

      {series.map((_, si) => {
        const pts = data
          .map((d, i) => `${xForIdx(i).toFixed(1)},${yForVal(d.values[si] ?? 0).toFixed(1)}`)
          .join(' ');
        return (
          <polyline
            key={si}
            points={pts}
            fill="none"
            stroke={colors[si % colors.length]}
            strokeWidth="1.5"
            strokeLinejoin="round"
            strokeLinecap="round"
          />
        );
      })}

      {/* X labels */}
      {data.map((d, i) =>
        i % step === 0 ? (
          <text
            key={i}
            x={xForIdx(i)}
            y={H - padB + 12}
            textAnchor="middle"
            fontSize="8"
            fill="#6b7280"
          >
            {d.label}
          </text>
        ) : null
      )}

      <line x1={padL} y1={padT} x2={padL} y2={padT + chartH} stroke="#d1d5db" strokeWidth="1" />
    </svg>
  );
}

// ─── Pie Chart ──────────────────────────────────────────────────────────────
export type PieSlice = { label: string; value: number; color: string };

export function PieChart({ slices, size = 120 }: { slices: PieSlice[]; size?: number }) {
  const total = slices.reduce((s, p) => s + p.value, 0);
  if (!total) return null;

  const cx = size / 2;
  const cy = size / 2;
  const r = size / 2 - 4;

  let angle = -Math.PI / 2; // start at top
  const paths = slices.map((s) => {
    const sweep = (s.value / total) * 2 * Math.PI;
    const x1 = cx + r * Math.cos(angle);
    const y1 = cy + r * Math.sin(angle);
    angle += sweep;
    const x2 = cx + r * Math.cos(angle);
    const y2 = cy + r * Math.sin(angle);
    const large = sweep > Math.PI ? 1 : 0;
    return { path: `M ${cx} ${cy} L ${x1.toFixed(2)} ${y1.toFixed(2)} A ${r} ${r} 0 ${large} 1 ${x2.toFixed(2)} ${y2.toFixed(2)} Z`, color: s.color };
  });

  return (
    <svg viewBox={`0 0 ${size} ${size}`} width={size} height={size} className="drop-shadow-sm">
      {paths.map((p, i) => (
        <path key={i} d={p.path} fill={p.color} stroke="white" strokeWidth="1.5" />
      ))}
    </svg>
  );
}

// ─── Legend ─────────────────────────────────────────────────────────────────
export function ChartLegend({ items, cols = 2 }: { items: { label: string; color: string }[]; cols?: number }) {
  return (
    <div className={`grid gap-x-3 gap-y-1`} style={{ gridTemplateColumns: `repeat(${cols}, 1fr)` }}>
      {items.map((item, i) => (
        <div key={i} className="flex items-center gap-1.5 text-[10px] text-gray-600 min-w-0">
          <span className="h-2.5 w-2.5 flex-shrink-0 rounded-sm" style={{ background: item.color }} />
          <span className="truncate">{item.label}</span>
        </div>
      ))}
    </div>
  );
}

// ─── Collapsible chart card ──────────────────────────────────────────────────
export function ChartCard({
  title,
  subtitle,
  children,
  defaultOpen = true,
  action,
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
  defaultOpen?: boolean;
  action?: ReactNode;
}) {
  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-100 mb-3 overflow-hidden">
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-50">
        <div>
          <h3 className="text-sm font-semibold text-gray-800">{title}</h3>
          {subtitle && <p className="text-[10px] text-gray-400 mt-0.5">{subtitle}</p>}
        </div>
        {action ?? <span className="text-gray-300 text-lg leading-none">^</span>}
      </div>
      <div className="p-4">{children}</div>
    </div>
  );
}

// ─── Period tab strip ────────────────────────────────────────────────────────
export function PeriodTabs({
  options,
  value,
  onChange,
}: {
  options: string[];
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div className="flex gap-0 mb-3">
      {options.map((o) => (
        <button
          key={o}
          onClick={() => onChange(o)}
          className={`flex-1 py-1.5 text-[11px] font-semibold border-b-2 transition ${
            value === o
              ? 'border-blue-700 text-blue-700'
              : 'border-transparent text-gray-400 hover:text-gray-600'
          }`}
        >
          {o}
        </button>
      ))}
    </div>
  );
}
