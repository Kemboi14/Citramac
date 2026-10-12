import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../../../auth/useAuth";
import {
  getInstruments,
  getOutcomeScores,
  type InstrumentDef,
  type OutcomeScore,
  type OutcomeSummary,
} from "../../../lib/carePathwayApi";
import { formatDateTime } from "../shared/format";
import { clientRecordPath } from "../shared/recordRoutes";
import { BTN_GHOST, BTN_SM, FIELD_LABEL } from "../shared/styles";
import { Card, ErrorNote, PageHeader, Tag } from "../shared/ui";
import { AssessmentForm } from "./intake/AssessmentForm";
import { LineChart } from "./LineChart";
import { scoreSeverity, severityTone, SCORE_SEVERITY_BANDS, type Instrument } from "./severity";
import type { RecordViewProps } from "./types";
import { useRecordData } from "./useRecordData";

function Trend({
  instrument,
  scores,
  loading,
}: {
  instrument: Instrument;
  scores: OutcomeScore[];
  loading: boolean;
}) {
  // eslint-disable-next-line security/detect-object-injection -- typed union key.
  const scale = SCORE_SEVERITY_BANDS[instrument];
  const rows = scores
    .filter((s) => s.instrument === instrument)
    .sort((a, b) => b.recorded_at.localeCompare(a.recorded_at));
  return (
    <div className="flex flex-col gap-1">
      <div className={FIELD_LABEL}>{scale.label} Trend</div>
      {loading ? (
        <p className="p-6 text-center text-[13px] text-ink-500">Loading…</p>
      ) : (
        <>
          <LineChart
            compact
            title={`${scale.label} trend`}
            domain={[0, scale.max]}
            series={[
              {
                label: scale.label,
                colorClass: "text-brand-green",
                points: rows.map((s) => ({ at: s.recorded_at, value: s.score })),
              },
            ]}
            emptyText={`No ${scale.label} outcome scores recorded for this client yet.`}
          />
          {rows.length > 0 && (
            <ul className="mt-1 flex flex-col gap-1">
              {rows.slice(0, 5).map((s) => {
                const severity = scoreSeverity(instrument, s.score);
                return (
                  <li key={s.id} className="flex flex-wrap items-center gap-2 text-[13px]">
                    <span className="font-mono text-xs text-ink-500">
                      {formatDateTime(s.recorded_at)}
                    </span>
                    <span className="font-semibold text-ink-900">{s.score}</span>
                    {severity && <Tag tone={severityTone(severity)}>{severity}</Tag>}
                  </li>
                );
              })}
            </ul>
          )}
        </>
      )}
    </div>
  );
}

/** Outcomes — docs/15-CLINICAL-WORKSPACE-V3.md §1.17; mockup `outcomes()`. */
export function OutcomesStage({ patientId, banner }: RecordViewProps) {
  const { accessToken } = useAuth();
  const [version, setVersion] = useState(0);
  const { data, error, loading } = useRecordData(
    patientId,
    version,
    (token) => getOutcomeScores(token, patientId),
    "Couldn't load outcome scores.",
  );
  const [defs, setDefs] = useState<InstrumentDef[]>([]);
  const [picking, setPicking] = useState("");
  useEffect(() => {
    if (!accessToken) return;
    void getInstruments(accessToken).then((r) => setDefs(r.results)).catch(() => undefined);
  }, [accessToken]);
  const scores = data?.results ?? [];
  const summary: OutcomeSummary[] = data?.summary ?? [];
  const pickedDef = defs.find((d) => d.code === picking);
  const name = banner.name.trim() || "Temporary client (unnamed)";
  return (
    <div>
      <PageHeader
        title="Outcomes"
        subtitle={`Review progress and update outcome measures for ${name}`}
      />
      <ErrorNote>{error}</ErrorNote>
      <Card title="Progress by measure" className="mt-3">
        {summary.length === 0 ? (
          <p className="text-[13px] text-ink-500">No completed measures are recorded yet.</p>
        ) : (
          <ul className="grid grid-cols-1 gap-3 md:grid-cols-2">
            {summary.map((m) => (
              <li key={m.instrument} className="rounded-lg border border-surface-border p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-[13px] font-semibold">{m.name}</span>
                  <Tag tone={m.change.direction === "bad" ? "risk" : m.change.direction === "good" ? "brand" : "neutral"}>
                    {m.change.text}
                  </Tag>
                </div>
                <div className="mt-1 text-[13px]">
                  Latest <strong>{m.latest.score}</strong>/{m.max} · {m.latest.band} · baseline {m.baseline.score}
                </div>
                {m.latest.flags.map((flag) => (
                  <p key={flag} role="alert" className="mt-1 text-[12px] font-semibold text-priority-red">{flag}</p>
                ))}
                {m.approval === "illustrative" && (
                  <p className="mt-1 text-[11px] text-ink-500">Illustrative bands — clinical approval pending.</p>
                )}
              </li>
            ))}
          </ul>
        )}
        <p className="mt-2 text-[11px] text-ink-500">
          Change is descriptive and does not replace clinical interpretation.
        </p>
      </Card>
      <Card title="Record a measure" className="mt-3">
        <div className="flex flex-wrap items-center gap-2">
          <select aria-label="Measure" className="rounded-lg border border-surface-border bg-surface-bg px-2.5 py-2 text-[13px]" value={picking} onChange={(e) => setPicking(e.target.value)}>
            <option value="">— choose a measure —</option>
            {defs.map((d) => (
              <option key={d.code} value={d.code}>{d.title}</option>
            ))}
          </select>
          {!pickedDef && <span className="text-xs text-ink-500">Enter the result of a completed assessment.</span>}
        </div>
        {pickedDef && (
          <AssessmentForm
            key={pickedDef.code}
            patientId={patientId}
            def={pickedDef}
            context="outcomes"
            onCancel={() => setPicking("")}
            onSaved={() => {
              setPicking("");
              setVersion((v) => v + 1);
            }}
          />
        )}
      </Card>
      <div className="mt-3 grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card title="Outcome Monitoring">
          <div className="flex flex-col gap-4">
            <Trend instrument="PHQ9" scores={scores} loading={loading && !data} />
            <Trend instrument="GAD7" scores={scores} loading={loading && !data} />
          </div>
        </Card>
        <Card title="Care Plan Review">
          <p className="p-6 text-center text-[13px] text-ink-500">
            Review progress against the client&apos;s documented care plan as outcomes are recorded.
          </p>
          <Link to={clientRecordPath(patientId, "care-plan")} className={`${BTN_GHOST} ${BTN_SM}`}>
            Review Care Plan
          </Link>
        </Card>
      </div>
    </div>
  );
}
