import { useId } from "react";
import { formatDate, formatDateTime } from "../shared/format";
import { TABLE, TD, TH } from "../shared/styles";

export interface ChartPoint {
  at: string;
  value: number;
}

export interface ChartSeries {
  label: string;
  /** Tailwind text-colour class on a theme token; marks draw in currentColor. */
  colorClass: string;
  points: ChartPoint[];
}

export interface ChartThreshold {
  value: number;
  /** A point breaches when it is above (or below) `value`. */
  breach: "above" | "below";
  label: string;
  /** Series the threshold applies to; omitted = every series. */
  series?: string;
}

const breaches = (t: ChartThreshold, seriesLabel: string, value: number) =>
  (!t.series || t.series === seriesLabel) &&
  (t.breach === "above" ? value > t.value : value < t.value);

const W = 320;
const H = 120;
const PAD = { top: 10, right: 12, bottom: 22, left: 34 };

function niceDomain(values: number[], fixed?: [number, number]): [number, number] {
  if (fixed) return fixed;
  let min = Math.min(...values);
  let max = Math.max(...values);
  if (min === max) {
    min -= 1;
    max += 1;
  }
  const pad = (max - min) * 0.15;
  return [Math.floor(min - pad), Math.ceil(max + pad)];
}

/**
 * Small inline SVG line chart (no chart library): one shared y-axis, 2px lines,
 * 8px markers with a native tooltip, a legend when there is more than one
 * series, and a values table beneath as the accessible fallback.
 */
export function LineChart({
  title,
  unit,
  series,
  domain,
  emptyText,
  formatValue = (value) => String(value),
  compact = false,
  thresholds = [],
  caption,
}: {
  title: string;
  unit?: string;
  series: ChartSeries[];
  domain?: [number, number];
  emptyText: string;
  formatValue?: (value: number) => string;
  compact?: boolean;
  thresholds?: ChartThreshold[];
  caption?: string;
}) {
  const titleId = useId();
  const withData = series.filter((s) => s.points.length > 0);
  if (withData.length === 0) {
    return <p className="py-6 text-center text-[13px] text-ink-500">{emptyText}</p>;
  }

  const allPoints = withData.flatMap((s) => s.points);
  const times = allPoints.map((p) => new Date(p.at).getTime());
  const t0 = Math.min(...times);
  const t1 = Math.max(...times);
  const [y0, y1] = niceDomain(
    [...allPoints.map((p) => p.value), ...thresholds.map((t) => t.value)],
    domain,
  );
  const isBreach = (seriesLabel: string, value: number) =>
    thresholds.some((t) => breaches(t, seriesLabel, value));
  const x = (at: string) => {
    const span = t1 - t0;
    const t = new Date(at).getTime();
    const ratio = span === 0 ? 0.5 : (t - t0) / span;
    return PAD.left + ratio * (W - PAD.left - PAD.right);
  };
  const y = (value: number) =>
    PAD.top + (1 - (value - y0) / (y1 - y0)) * (H - PAD.top - PAD.bottom);
  const unitSuffix = unit ? ` ${unit}` : "";

  // Rows for the values table: one per timestamp, one column per series.
  const stamps = Array.from(new Set(allPoints.map((p) => p.at))).sort((a, b) => b.localeCompare(a));

  return (
    <div>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        role="img"
        aria-labelledby={titleId}
        className={`w-full ${compact ? "max-h-[110px]" : "max-h-[160px]"}`}
      >
        <title id={titleId}>
          {`${title}: ${allPoints.length} value${allPoints.length === 1 ? "" : "s"} from ${formatDate(
            new Date(t0).toISOString(),
          )} to ${formatDate(new Date(t1).toISOString())}`}
        </title>
        <g className="text-ink-300" stroke="currentColor" strokeWidth={1}>
          <line x1={PAD.left} x2={W - PAD.right} y1={y(y1)} y2={y(y1)} strokeDasharray="2 3" />
          <line x1={PAD.left} x2={W - PAD.right} y1={y(y0)} y2={y(y0)} />
        </g>
        <g className="fill-ink-500 text-[9px]">
          <text x={PAD.left - 5} y={y(y1) + 3} textAnchor="end">
            {formatValue(y1)}
          </text>
          <text x={PAD.left - 5} y={y(y0) + 3} textAnchor="end">
            {formatValue(y0)}
          </text>
          <text x={PAD.left} y={H - 6} textAnchor="start">
            {formatDate(new Date(t0).toISOString())}
          </text>
          {t1 !== t0 && (
            <text x={W - PAD.right} y={H - 6} textAnchor="end">
              {formatDate(new Date(t1).toISOString())}
            </text>
          )}
        </g>
        {thresholds.map((t) => (
          <g key={`${t.label}-${t.value}`} className="text-priority-red">
            <line
              x1={PAD.left}
              x2={W - PAD.right}
              y1={y(t.value)}
              y2={y(t.value)}
              stroke="currentColor"
              strokeWidth={1}
              strokeDasharray="4 3"
              opacity={0.7}
            />
            <text
              x={W - PAD.right}
              y={y(t.value) - 3}
              textAnchor="end"
              fill="currentColor"
              className="text-[8.5px] font-semibold"
            >
              {t.label}
            </text>
          </g>
        ))}
        {withData.map((s) => {
          const sorted = [...s.points].sort((a, b) => a.at.localeCompare(b.at));
          return (
            <g key={s.label} className={s.colorClass}>
              {sorted.length > 1 && (
                <polyline
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={2}
                  strokeLinejoin="round"
                  strokeLinecap="round"
                  points={sorted.map((p) => `${x(p.at)},${y(p.value)}`).join(" ")}
                />
              )}
              {sorted.map((p) => {
                const breach = isBreach(s.label, p.value);
                return (
                  <circle
                    key={p.at}
                    cx={x(p.at)}
                    cy={y(p.value)}
                    r={breach ? 4.5 : 4}
                    fill="currentColor"
                    className={breach ? "text-priority-red" : undefined}
                    stroke="var(--card)"
                    strokeWidth={2}
                  >
                    <title>{`${s.label} ${formatValue(p.value)}${unitSuffix} · ${formatDateTime(p.at)}${breach ? " · outside threshold" : ""}`}</title>
                  </circle>
                );
              })}
            </g>
          );
        })}
      </svg>
      {withData.length > 1 && (
        <ul className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-[11.5px] text-ink-700">
          {withData.map((s) => (
            <li key={s.label} className="flex items-center gap-1.5">
              <span aria-hidden="true" className={`h-0.5 w-4 rounded bg-current ${s.colorClass}`} />
              {s.label}
            </li>
          ))}
        </ul>
      )}
      {(thresholds.length > 0 || caption) && (
        <p className="mt-1 text-[11px] text-ink-500">
          {thresholds.length > 0 && (
            <>
              <span className="font-semibold text-priority-red">- - -</span> thresholds;{" "}
              <span className="font-semibold text-priority-red">●</span> value outside a
              threshold.{" "}
            </>
          )}
          {caption}
        </p>
      )}
      <details className="mt-2">
        <summary className="cursor-pointer text-xs font-semibold text-ink-500 hover:text-ink-900">
          Values ({stamps.length})
        </summary>
        <div className="mt-2 max-h-56 overflow-auto">
          <table className={TABLE}>
            <thead>
              <tr>
                <th className={TH}>Recorded</th>
                {withData.map((s) => (
                  <th key={s.label} className={TH}>
                    {s.label}
                    {unit ? ` (${unit})` : ""}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {stamps.map((at) => (
                <tr key={at}>
                  <td className={`${TD} whitespace-nowrap font-mono text-xs`}>
                    {formatDateTime(at)}
                  </td>
                  {withData.map((s) => {
                    const point = s.points.find((p) => p.at === at);
                    const breach = point ? isBreach(s.label, point.value) : false;
                    return (
                      <td
                        key={s.label}
                        className={`${TD} ${breach ? "font-semibold text-priority-red" : ""}`}
                      >
                        {point ? formatValue(point.value) : "—"}
                        {breach && <span className="sr-only"> (outside threshold)</span>}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </div>
  );
}
