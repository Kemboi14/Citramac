import { useState } from "react";
import type { InstrumentDef } from "../../../../lib/carePathwayApi";
import type { OutcomesOverview } from "../../../../lib/carePlanOutcomesApi";
import { formatDate, formatDateTime } from "../../shared/format";
import { BTN_GHOST, BTN_SM, FIELD_LABEL, INPUT, TABLE, TD, TH } from "../../shared/styles";
import { Callout, Card, Tag } from "../../shared/ui";
import { useValueSets } from "../../shared/useValueSets";
import { AssessmentForm } from "../intake/AssessmentForm";
import { LineChart } from "../LineChart";

/** Every measure the instruments module supports, baseline → latest with the
 * change stated in words, as charts or a table; and the record form offering
 * the measures that fit this client. Scores from intake, therapy and
 * withdrawal charts appear here too — one store. */
export function MeasuresPanel({
  patientId,
  overview,
  defs,
  onRecorded,
}: {
  patientId: string;
  overview: OutcomesOverview;
  defs: InstrumentDef[];
  onRecorded: () => void;
}) {
  const vs = useValueSets();
  const [asTable, setAsTable] = useState(false);
  const [picking, setPicking] = useState("");
  const pickedDef = defs.find((d) => d.code === picking);
  const cri = overview.summary.find((m) => m.instrument === "CRI");
  const recorded = new Set(overview.scores.map((s) => s.instrument));

  return (
    <div className="flex flex-col gap-4">
      <Card
        title="Outcome measures"
        aside={
          <button type="button" className={`${BTN_GHOST} ${BTN_SM}`} onClick={() => setAsTable((v) => !v)}>
            {asTable ? "View as charts" : "View as table"}
          </button>
        }
      >
        {overview.summary.length === 0 ? (
          <p className="text-[13px] text-ink-500">
            No outcome measures yet. Record a baseline below — scores from intake, therapy sessions and withdrawal charts appear here too.
          </p>
        ) : asTable ? (
          <div className="overflow-x-auto">
            <table className={`${TABLE} min-w-[640px]`}>
              <thead>
                <tr>
                  <th className={TH}>Measure</th>
                  <th className={TH}>Date</th>
                  <th className={`${TH} text-right`}>Score</th>
                  <th className={TH}>Band</th>
                  <th className={TH}>Timepoint</th>
                  <th className={TH}>By</th>
                </tr>
              </thead>
              <tbody>
                {overview.scores.map((s) => (
                  <tr key={s.id}>
                    <td className={TD}>{s.name}</td>
                    <td className={TD}>{formatDateTime(s.recorded_at)}</td>
                    <td className={`${TD} text-right font-mono`}>{s.score} / {s.max}</td>
                    <td className={TD}>{s.band || "—"}</td>
                    <td className={TD}>{s.timepoint ? vs.label("assessment-timepoint", s.timepoint) : "—"}</td>
                    <td className={TD}>{s.recorded_by || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <ul className="grid grid-cols-1 gap-3 md:grid-cols-2">
            {overview.summary.map((m) => (
              <li key={m.instrument} className="rounded-lg border border-surface-border p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-[13px] font-semibold">{m.name}</span>
                  <Tag tone={m.change.direction === "bad" ? "risk" : m.change.direction === "good" ? "brand" : "neutral"}>
                    {m.change.text}
                  </Tag>
                </div>
                <div className="mt-1 text-[13px]">
                  Latest <strong>{m.latest.score}</strong> / {m.max} · {m.latest.band} · baseline <strong>{m.baseline.score}</strong> ({formatDate(m.baseline.at)})
                </div>
                {m.latest.flags.map((flag) => (
                  <p key={flag} role="alert" className="mt-1 text-[12px] font-semibold text-priority-red">{flag}</p>
                ))}
                <div className="mt-2">
                  <LineChart
                    compact
                    title={`${m.name} trend`}
                    domain={[0, m.max]}
                    series={[{ label: m.name, colorClass: "text-brand-green", points: m.series.map((p) => ({ at: p.at, value: p.score })) }]}
                    emptyText={`No ${m.name} scores yet.`}
                  />
                </div>
                {m.approval === "illustrative" && (
                  <p className="mt-1 text-[11px] text-ink-500">Illustrative bands — clinical approval pending.</p>
                )}
              </li>
            ))}
          </ul>
        )}
        <p className="mt-2 text-[11px] text-ink-500">Change is descriptive and does not replace clinical interpretation.</p>
      </Card>

      <Callout>
        <strong>CRI is experimental</strong> — items, scoring and minimal important difference are not yet published.{" "}
        {cri ? `Baseline ${cri.baseline.score} → latest ${cri.latest.score}.` : "No CRI baseline yet."}
      </Callout>
      {overview.discharge_measures_due && (
        <Callout tone="warning">Record discharge measures with timepoint “Discharge”.</Callout>
      )}

      <Card title="Record a measure" aside={<span className="text-[11px] text-ink-500">the same instruments and store used at intake</span>}>
        <label className="flex max-w-md flex-col gap-1">
          <span className={FIELD_LABEL}>Measure</span>
          <select aria-label="Measure" className={INPUT} value={picking} onChange={(e) => setPicking(e.target.value)}>
            <option value="">— choose —</option>
            {overview.measure_options.map((o) => (
              <option key={o.code} value={o.code}>
                {o.name}
                {o.why ? ` — ${o.why}` : ""}
              </option>
            ))}
          </select>
        </label>
        {pickedDef && (
          <AssessmentForm
            key={pickedDef.code}
            patientId={patientId}
            def={pickedDef}
            context="outcomes"
            hasPrevious={recorded.has(pickedDef.code)}
            defaultTimepoint={overview.discharge_measures_due ? "DISCHARGE" : undefined}
            showProvenance
            onCancel={() => setPicking("")}
            onSaved={() => {
              setPicking("");
              onRecorded();
            }}
          />
        )}
      </Card>
    </div>
  );
}
