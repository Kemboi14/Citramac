import {
  getClientVitals,
  getOutcomeScores,
  getTriageThresholds,
  type VitalRow,
} from "../../../lib/carePathwayApi";
import { Card, ErrorNote } from "../shared/ui";
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
