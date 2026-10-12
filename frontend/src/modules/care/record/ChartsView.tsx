import {
  getClientVitals,
  getOutcomeScores,
  getTriageThresholds,
  type VitalRow,
} from "../../../lib/carePathwayApi";
import { formatDateTime } from "../shared/format";
import { TABLE, TD, TH } from "../shared/styles";
import { Card, ErrorNote, Tag } from "../shared/ui";
import { LineChart, type ChartPoint, type ChartThreshold } from "./LineChart";
import type { RecordViewProps } from "./types";
import { useRecordData } from "./useRecordData";

function vitalPoints(rows: VitalRow[], pick: (row: VitalRow) => number | string | null) {
  const points: ChartPoint[] = [];
  for (const row of rows) {
    const raw = pick(row);
    const value = raw === null ? NaN : Number(raw);
    if (row.recorded_at && Number.isFinite(value)) points.push({ at: row.recorded_at, value });
  }
  return points;
}

/** Charts — vital-sign and outcome-score trends from the record. */
export function ChartsView({ patientId }: RecordViewProps) {
  const vitals = useRecordData(
    patientId,
    0,
    (token) => getClientVitals(token, patientId),
    "Couldn't load vital signs.",
  );
  const scores = useRecordData(
    patientId,
    0,
    (token) => getOutcomeScores(token, patientId),
    "Couldn't load outcome scores.",
  );
  const rules = useRecordData(
    "triage-thresholds",
    0,
    (token) => getTriageThresholds(token),
    "Couldn't load the triage thresholds.",
  );
  const t = rules.data?.vital_thresholds;
  const caption = rules.data
    ? `Thresholds from triage rules ${rules.data.rules_version}.`
    : rules.error
      ? "Thresholds unavailable."
      : undefined;
  const hrThresholds: ChartThreshold[] = t
    ? [
        { value: t.pulse_above, breach: "above", label: `> ${t.pulse_above}` },
        { value: t.pulse_below, breach: "below", label: `< ${t.pulse_below}` },
      ]
    : [];
  const bpThresholds: ChartThreshold[] = t
    ? [
        {
          value: t.systolic_above,
          breach: "above",
          label: `Systolic > ${t.systolic_above}`,
          series: "Systolic",
        },
      ]
    : [];
  const spo2Thresholds: ChartThreshold[] = t
    ? [{ value: t.spo2_below, breach: "below", label: `< ${t.spo2_below}` }]
    : [];
  const tempThresholds: ChartThreshold[] = t
    ? [{ value: t.temperature_above, breach: "above", label: `> ${t.temperature_above}` }]
    : [];
  const rows = vitals.data?.results ?? [];
  const outcomeRows = scores.data?.results ?? [];
  const outcome = (instrument: "PHQ9" | "GAD7") =>
    outcomeRows
      .filter((s) => s.instrument === instrument)
      .map((s) => ({ at: s.recorded_at, value: s.score }));
  const loadingVitals = vitals.loading && !vitals.data;
  const loadingScores = scores.loading && !scores.data;
  const loadingText = <p className="py-6 text-center text-[13px] text-ink-500">Loading…</p>;

  return (
    <div className="flex flex-col gap-4">
      <ErrorNote>{vitals.error ?? scores.error}</ErrorNote>
      <EwsCard rows={rows} loading={loadingVitals} />
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card title="Heart rate">
          {loadingVitals ? (
            loadingText
          ) : (
            <LineChart
              title="Heart rate"
              thresholds={hrThresholds}
              caption={caption}
              unit="bpm"
              series={[
                {
                  label: "Heart rate",
                  colorClass: "text-chart-1",
                  points: vitalPoints(rows, (r) => r.heart_rate),
                },
              ]}
              emptyText="No heart rate recorded for this client yet."
            />
          )}
        </Card>
        <Card title="Blood pressure">
          {loadingVitals ? (
            loadingText
          ) : (
            <LineChart
              title="Blood pressure"
              thresholds={bpThresholds}
              caption={caption}
              unit="mmHg"
              series={[
                {
                  label: "Systolic",
                  colorClass: "text-chart-1",
                  points: vitalPoints(rows, (r) => r.systolic_bp),
                },
                {
                  label: "Diastolic",
                  colorClass: "text-chart-2",
                  points: vitalPoints(rows, (r) => r.diastolic_bp),
                },
              ]}
              emptyText="No blood pressure recorded for this client yet."
            />
          )}
        </Card>
        <Card title="Temperature">
          {loadingVitals ? (
            loadingText
          ) : (
            <LineChart
              title="Temperature"
              thresholds={tempThresholds}
              caption={caption}
              unit="°C"
              series={[
                {
                  label: "Temperature",
                  colorClass: "text-chart-1",
                  points: vitalPoints(rows, (r) => r.temperature_c),
                },
              ]}
              formatValue={(v) => v.toFixed(1)}
              emptyText="No temperature recorded for this client yet."
            />
          )}
        </Card>
        <Card title="SpO₂">
          {loadingVitals ? (
            loadingText
          ) : (
            <LineChart
              title="SpO₂"
              thresholds={spo2Thresholds}
              caption={caption}
              unit="%"
              series={[
                {
                  label: "SpO₂",
                  colorClass: "text-chart-1",
                  points: vitalPoints(rows, (r) => r.spo2),
                },
              ]}
              emptyText="No SpO₂ recorded for this client yet."
            />
          )}
        </Card>
        <Card title="Respiratory rate">
          {loadingVitals ? (
            loadingText
          ) : (
            <LineChart
              title="Respiratory rate"
              unit="/min"
              series={[
                {
                  label: "Respiratory rate",
                  colorClass: "text-chart-1",
                  points: vitalPoints(rows, (r) => r.respiratory_rate),
                },
              ]}
              emptyText="No respiratory rate recorded for this client yet."
            />
          )}
        </Card>
        <Card title="Blood glucose">
          {loadingVitals ? (
            loadingText
          ) : (
            <LineChart
              title="Blood glucose"
              unit="mmol/L"
              series={[
                {
                  label: "Blood glucose",
                  colorClass: "text-chart-1",
                  points: vitalPoints(rows, (r) => r.blood_glucose_mmol),
                },
              ]}
              formatValue={(v) => v.toFixed(1)}
              emptyText="No blood glucose recorded for this client yet."
            />
          )}
        </Card>
        <Card title="PHQ-9">
          {loadingScores ? (
            loadingText
          ) : (
            <LineChart
              title="PHQ-9"
              series={[{ label: "PHQ-9", colorClass: "text-brand-green", points: outcome("PHQ9") }]}
              domain={[0, 27]}
              emptyText="No PHQ-9 outcome scores recorded for this client yet."
            />
          )}
        </Card>
        <Card title="GAD-7">
          {loadingScores ? (
            loadingText
          ) : (
            <LineChart
              title="GAD-7"
              series={[{ label: "GAD-7", colorClass: "text-brand-green", points: outcome("GAD7") }]}
              domain={[0, 21]}
              emptyText="No GAD-7 outcome scores recorded for this client yet."
            />
          )}
        </Card>
      </div>
    </div>
  );
}

/** Early warning score per observation set, with the escalation prompt for the
 * latest. An unmeasured parameter is never scored as normal. */
function EwsCard({ rows, loading }: { rows: VitalRow[]; loading: boolean }) {
  const scored = rows.filter((r) => r.ews);
  const latest = scored.at(-1)?.ews;
  const tone = latest?.response.tone;
  return (
    <Card
      title="Early warning score"
      aside={latest?.approval === "illustrative" ? <Tag tone="warn">Illustrative thresholds — clinical approval pending</Tag> : undefined}
    >
      {loading ? (
        <p className="py-6 text-center text-[13px] text-ink-500">Loading…</p>
      ) : !latest ? (
        <p className="py-4 text-[13px] text-ink-500">No observations recorded for this client yet.</p>
      ) : (
        <div className="flex flex-col gap-3">
          <div
            role="status"
            className={`rounded-lg border px-3 py-2 text-[13px] font-semibold ${
              tone === "bad"
                ? "border-priority-red bg-priority-red-tint text-priority-red"
                : tone === "warn"
                  ? "border-priority-orange bg-priority-orange-tint text-priority-orange"
                  : "border-brand-green bg-brand-green-tint text-brand-green-dark"
            }`}
          >
            {latest.label} — {latest.response.text}
          </div>
          <LineChart
            compact
            title="Early warning score"
            domain={[0, 20]}
            series={[
              {
                label: "EWS",
                colorClass: "text-chart-1",
                points: scored
                  .filter((r) => r.ews!.measured > 0)
                  .map((r) => ({ at: r.recorded_at, value: r.ews!.score })),
              },
            ]}
            emptyText="No scored observation sets yet."
          />
          <div className="overflow-x-auto">
            <table className={TABLE}>
              <thead>
                <tr>
                  <th className={TH}>Recorded</th>
                  <th className={TH}>Score</th>
                  <th className={TH}>Measured</th>
                </tr>
              </thead>
              <tbody>
                {[...scored].reverse().slice(0, 8).map((r) => (
                  <tr key={r.id}>
                    <td className={TD}>{formatDateTime(r.recorded_at)}</td>
                    <td className={TD}>{r.ews!.label}</td>
                    <td className={TD}>{r.ews!.measured}/{r.ews!.total_parameters}{r.ews!.single_parameter_3 ? " · a parameter scores 3" : ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </Card>
  );
}
