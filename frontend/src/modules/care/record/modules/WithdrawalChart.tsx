import type { WithdrawalScale } from "../../../../lib/carePathwayApi";
import { formatDateTime } from "../../shared/format";
import { TABLE, TD, TH } from "../../shared/styles";

const W = 600;
const H = 140;
const PAD_X = 28;
const PAD_TOP = 20;
const PAD_BOTTOM = 16;

/** Serial withdrawal-score trend. The dashed line is the facility's PRN
 * threshold and is drawn only when the protocol configures one. Each point
 * carries its own tooltip; the history table below is the text view. */
export function WithdrawalTrend({ scale, max }: { scale: WithdrawalScale; max: number }) {
  const points = scale.series;
  if (!points.length) return null;
  const plotH = H - PAD_TOP - PAD_BOTTOM;
  const y = (v: number) => PAD_TOP + plotH - (Math.min(v, max) / max) * plotH;
  const x = (i: number) => (points.length === 1 ? W / 2 : PAD_X + (i * (W - 2 * PAD_X)) / (points.length - 1));
  const threshold = scale.prnThreshold;
  const label = `${scale.name} scores over time: ${points.map((p) => p.score).join(", ")}.${threshold != null ? ` PRN threshold ${threshold}.` : ""}`;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="mt-2 h-auto w-full" role="img" aria-label={label}>
      <line x1={0} x2={W} y1={y(0)} y2={y(0)} stroke="var(--ink-300)" strokeWidth={1} />
      {threshold != null && (
        <g>
          <line x1={0} x2={W} y1={y(threshold)} y2={y(threshold)} stroke="var(--pri-red)" strokeWidth={1.5} strokeDasharray="5 4" />
          <text x={W - 4} y={y(threshold) - 5} textAnchor="end" fontSize={11} fill="var(--ink-700)">
            PRN threshold {threshold}
          </text>
        </g>
      )}
      {points.length > 1 && (
        <polyline
          fill="none"
          stroke="var(--chart-1)"
          strokeWidth={2}
          strokeLinejoin="round"
          points={points.map((p, i) => `${x(i)},${y(p.score)}`).join(" ")}
        />
      )}
      {points.map((p, i) => (
        <g key={p.at}>
          <circle cx={x(i)} cy={y(p.score)} r={10} fill="transparent">
            <title>{`${p.score} — ${formatDateTime(p.at)}`}</title>
          </circle>
          <circle cx={x(i)} cy={y(p.score)} r={4} fill="var(--chart-1)" stroke="var(--card)" strokeWidth={2} pointerEvents="none" />
          {(i === points.length - 1 || points.length <= 8) && (
            <text x={x(i)} y={y(p.score) - 9} textAnchor="middle" fontSize={11} fill="var(--ink-900)" pointerEvents="none">
              {p.score}
            </text>
          )}
        </g>
      ))}
    </svg>
  );
}

/** The last six entries — scores and unable-to-score attempts — newest first. */
export function WithdrawalHistory({ scale }: { scale: WithdrawalScale }) {
  if (!scale.history.length) return null;
  return (
    <div className="mt-2 overflow-x-auto">
      <table className={TABLE}>
        <thead>
          <tr>
            <th className={TH}>Time</th>
            <th className={TH}>Score</th>
            <th className={TH}>Band</th>
            <th className={TH}>By</th>
          </tr>
        </thead>
        <tbody>
          {scale.history.map((h) => (
            <tr key={`${h.at}-${h.score ?? "u"}`}>
              <td className={TD}>{formatDateTime(h.at)}</td>
              <td className={`${TD} font-mono`}>{h.score ?? "—"}</td>
              <td className={TD}>{h.score == null ? `Unable to score — ${h.unable}` : h.band}</td>
              <td className={TD}>{h.by}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
