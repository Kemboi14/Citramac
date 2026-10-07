import { useState } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../../../auth/useAuth";
import { ApiError } from "../../../lib/apiClient";
import {
  getClientSnapshot,
  resolveAlert,
  type AlertRecord,
  type EpisodeSummary,
  type VitalRow,
} from "../../../lib/carePathwayApi";
import { formatDateTime } from "../shared/format";
import { BTN_GHOST, BTN_SM, TABLE, TD, TH } from "../shared/styles";
import { Card, ErrorNote, PriorityPill, Tag, Timeline } from "../shared/ui";
import { useValueSets } from "../shared/useValueSets";
import { scoreSeverity, severityTone, SCORE_SEVERITY_BANDS, type Instrument } from "./severity";
import type { RecordViewProps } from "./types";
import { useRecordData } from "./useRecordData";

const EMPTY = "text-[13px] text-ink-500";

function vitalItems(v: VitalRow) {
  return [
    [
      "Blood pressure",
      v.systolic_bp !== null ? `${v.systolic_bp}/${v.diastolic_bp ?? "—"} mmHg` : null,
    ],
    ["Heart rate", v.heart_rate !== null ? `${v.heart_rate} bpm` : null],
    ["Respiratory rate", v.respiratory_rate !== null ? `${v.respiratory_rate} /min` : null],
    ["Temperature", v.temperature_c !== null ? `${v.temperature_c} °C` : null],
    ["SpO₂", v.spo2 !== null ? `${v.spo2}%` : null],
    ["Blood glucose", v.blood_glucose_mmol !== null ? `${v.blood_glucose_mmol} mmol/L` : null],
  ] as const;
}

/** Snapshot — the client's current picture at a glance, from the record. */
export function SnapshotView({ patientId, onRecordChanged }: RecordViewProps) {
  const vs = useValueSets();
  const [version, setVersion] = useState(0);
  const { data, error, loading } = useRecordData(
    patientId,
    version,
    (token) => getClientSnapshot(token, patientId),
    "Couldn't load the client snapshot.",
  );

  if (error && !data) return <ErrorNote>{error}</ErrorNote>;
  if (loading && !data) return <p className={EMPTY}>Loading snapshot…</p>;
  if (!data) return null;
  const triage = data.triage;

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
      <EpisodeCard episode={data.episode} />
      <AlertsCard
        alerts={data.alerts}
        onResolved={() => {
          setVersion((v) => v + 1);
          onRecordChanged();
        }}
      />
      <Card title="Presenting concern">
        <p className="whitespace-pre-wrap text-[13px] text-ink-900">
          {data.presenting_concern || <span className="text-ink-500">Not yet recorded.</span>}
        </p>
      </Card>

      <Card
        title="Latest signed triage"
        aside={triage ? <PriorityPill priority={triage.final_priority} long /> : undefined}
        className="lg:row-span-2"
      >
        {triage ? (
          <div className="flex flex-col gap-3">
            {triage.recommendation && (
              <div>
                <div className="text-[11px] font-semibold uppercase tracking-wide text-ink-500">
                  Recommendation
                </div>
                <p className="text-[13px] text-ink-900">{triage.recommendation}</p>
                {triage.recommendation_reasons && (
                  <p className="text-xs text-ink-500">{triage.recommendation_reasons}</p>
                )}
              </div>
            )}
            {triage.decision === "OVERRIDE" && triage.override_reason && (
              <p className="text-xs text-ink-700">
                <strong>Priority overridden:</strong> {triage.override_reason}
              </p>
            )}
            {triage.findings.length > 0 ? (
              <div className="overflow-x-auto">
                <table className={TABLE}>
                  <thead>
                    <tr>
                      <th className={TH}>Finding / alert</th>
                      <th className={TH}>Current status</th>
                      <th className={TH}>Source</th>
                    </tr>
                  </thead>
                  <tbody>
                    {triage.findings.map(([finding, status, source], index) => (
                      <tr key={`${finding}-${index}`}>
                        <td className={TD}>{finding}</td>
                        <td className={TD}>{status}</td>
                        <td className={TD}>{source}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className={EMPTY}>No findings recorded at triage.</p>
            )}
            <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-ink-500">
              <span>
                Signed {formatDateTime(triage.signed_at)} ·{" "}
                {triage.signed_by || "Clinician not recorded"} · v{triage.version}
              </span>
              <Link
                to={`/clinical/documents/${triage.id}`}
                className="font-semibold text-brand-green hover:underline"
              >
                View signed triage
              </Link>
            </div>
          </div>
        ) : (
          <p className={EMPTY}>No signed triage for this client yet.</p>
        )}
      </Card>

      <Card title="Active diagnoses">
        {data.diagnoses.length > 0 ? (
          <ul className="flex flex-col gap-2">
            {data.diagnoses.map((d) => (
              <li key={d.id} className="flex flex-wrap items-center gap-2 text-[13px] text-ink-900">
                <span className="font-mono text-xs font-semibold text-brand-green">{d.code}</span>
                <span>{d.description}</span>
                {d.is_primary && <Tag tone="brand">Primary</Tag>}
              </li>
            ))}
          </ul>
        ) : (
          <p className={EMPTY}>No active diagnoses recorded.</p>
        )}
      </Card>

      <Card title="Latest vitals">
        {data.latest_vitals ? (
          <>
            <dl className="grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-3">
              {vitalItems(data.latest_vitals).map(([label, value]) => (
                <div key={label}>
                  <dt className="text-[11px] font-semibold uppercase tracking-wide text-ink-500">
                    {label}
                  </dt>
                  <dd className="text-[13px] font-semibold text-ink-900">
                    {value ?? <span className="font-normal text-ink-400">Not measured</span>}
                  </dd>
                </div>
              ))}
            </dl>
            <p className="mt-3 text-xs text-ink-500">
              Recorded {formatDateTime(data.latest_vitals.recorded_at)}
              {data.latest_vitals.recorded_by && ` · ${data.latest_vitals.recorded_by}`}
            </p>
          </>
        ) : (
          <p className={EMPTY}>No vitals recorded.</p>
        )}
      </Card>

      <Card title="Outcome scores">
        <ul className="flex flex-col gap-2">
          {(["PHQ9", "GAD7"] as Instrument[]).map((instrument) => {
            // eslint-disable-next-line security/detect-object-injection -- typed union key.
            const score = data.latest_scores[instrument];
            // eslint-disable-next-line security/detect-object-injection -- typed union key.
            const name = SCORE_SEVERITY_BANDS[instrument].label;
            const severity = score ? scoreSeverity(instrument, score.score) : "";
            return (
              <li key={instrument} className="flex flex-wrap items-center gap-2 text-[13px]">
                <span className="w-14 font-semibold text-ink-900">{name}</span>
                {score ? (
                  <>
                    <span className="font-semibold text-ink-900">{score.score}</span>
                    {severity && <Tag tone={severityTone(severity)}>{severity}</Tag>}
                    <span className="text-xs text-ink-500">
                      {formatDateTime(score.recorded_at)}
                    </span>
                  </>
                ) : (
                  <span className="text-ink-500">Not recorded</span>
                )}
              </li>
            );
          })}
        </ul>
      </Card>

      <Card title="Care plan actions">
        {data.care_plan_activities.length > 0 ? (
          <ul className="flex flex-col gap-2">
            {data.care_plan_activities.map((a) => (
              <li key={a.id} className="flex flex-wrap items-center gap-2 text-[13px] text-ink-900">
                <span className="font-semibold">{a.title}</span>
                <Tag tone={a.status === "ACTIVE" ? "risk" : "neutral"}>
                  {vs.label("care-activity-status", a.status)}
                </Tag>
              </li>
            ))}
          </ul>
        ) : (
          <p className={EMPTY}>No care plan actions documented yet.</p>
        )}
      </Card>

      <Card title="Next appointment">
        {data.next_appointment ? (
          <p className="text-[13px] text-ink-900">
            <span className="font-semibold">
              {formatDateTime(data.next_appointment.scheduled_for)}
            </span>
            {" · "}
            {data.next_appointment.appointment_type || "Appointment"}
          </p>
        ) : (
          <p className={EMPTY}>No upcoming appointment scheduled.</p>
        )}
      </Card>
    </div>
  );
}

function waitText(minutes: number) {
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${minutes} min (${hours} h ${minutes % 60} min)`;
  return `${minutes} min (${Math.floor(hours / 24)} days)`;
}

/** EpisodeOfCare — the organisational container; statusHistory holds the wait. */
function EpisodeCard({ episode }: { episode: EpisodeSummary | null }) {
  return (
    <Card
      title="Episode of care"
      aside={episode ? <Tag tone="brand">{episode.status_label}</Tag> : undefined}
    >
      {episode ? (
        <div className="flex flex-col gap-3">
          <dl className="grid grid-cols-1 gap-x-4 gap-y-2 sm:grid-cols-2">
            <div>
              <dt className="text-[11px] font-semibold uppercase tracking-wide text-ink-500">
                Started
              </dt>
              <dd className="text-[13px] text-ink-900">{formatDateTime(episode.period_start)}</dd>
            </div>
            {episode.period_end && (
              <div>
                <dt className="text-[11px] font-semibold uppercase tracking-wide text-ink-500">
                  Ended
                </dt>
                <dd className="text-[13px] text-ink-900">{formatDateTime(episode.period_end)}</dd>
              </div>
            )}
            <div>
              <dt className="text-[11px] font-semibold uppercase tracking-wide text-ink-500">
                Care manager
              </dt>
              <dd className="text-[13px] text-ink-900">
                {episode.care_manager || <span className="text-ink-400">Not assigned</span>}
              </dd>
            </div>
            <div>
              <dt className="text-[11px] font-semibold uppercase tracking-wide text-ink-500">
                Waiting time
              </dt>
              <dd className="text-[13px] text-ink-900">
                {episode.still_waiting ? (
                  <span className="font-semibold text-priority-orange">
                    Waiting since {formatDateTime(episode.period_start)}
                  </span>
                ) : episode.waiting_minutes !== null ? (
                  `Waited ${waitText(episode.waiting_minutes)} from waitlist to active`
                ) : (
                  <span className="text-ink-400">Not recorded</span>
                )}
              </dd>
            </div>
          </dl>
          {episode.history.length > 0 && (
            <div>
              <div className="mb-2 text-[11px] font-bold uppercase tracking-wide text-ink-500">
                Status history
              </div>
              <Timeline
                items={[...episode.history]
                  .sort((a, b) => b.period_start.localeCompare(a.period_start))
                  .map((h, index) => ({
                    key: `${h.status}-${h.period_start}-${index}`,
                    time: formatDateTime(h.period_start),
                    title: h.status_label,
                    detail: [
                      h.period_end ? `until ${formatDateTime(h.period_end)}` : "current",
                      h.changed_by,
                    ]
                      .filter(Boolean)
                      .join(" · "),
                  }))}
              />
            </div>
          )}
        </div>
      ) : (
        <p className={EMPTY}>No episode of care is open for this client.</p>
      )}
    </Card>
  );
}

function AlertsCard({ alerts, onResolved }: { alerts: AlertRecord[]; onResolved: () => void }) {
  const { accessToken } = useAuth();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const active = alerts.filter((a) => a.status === "ACTIVE");
  const resolved = alerts.filter((a) => a.status !== "ACTIVE");

  const resolve = async (alert: AlertRecord) => {
    if (!accessToken) return;
    if (!window.confirm(`Resolve the alert “${alert.label}”? It will leave the safety banner.`)) {
      return;
    }
    setBusy(alert.id);
    setError(null);
    try {
      await resolveAlert(accessToken, alert.id);
      onResolved();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't resolve the alert.");
    } finally {
      setBusy(null);
    }
  };

  return (
    <Card
      title="Clinical alerts"
      aside={<Tag tone={active.length ? "warn" : "neutral"}>{active.length} active</Tag>}
    >
      <ErrorNote>{error}</ErrorNote>
      {active.length > 0 ? (
        <ul className="flex flex-col divide-y divide-surface-border">
          {active.map((alert) => (
            <li
              key={alert.id}
              className="flex flex-wrap items-center justify-between gap-2 py-2 first:pt-0"
            >
              <div className="min-w-0">
                <div className="text-[13px] font-semibold text-priority-orange">{alert.label}</div>
                <div className="text-xs text-ink-500">
                  Raised {formatDateTime(alert.raised_at)}
                  {alert.raised_by && ` · ${alert.raised_by}`}
                </div>
              </div>
              <button
                type="button"
                className={`${BTN_GHOST} ${BTN_SM}`}
                disabled={busy !== null}
                aria-label={`Resolve alert ${alert.label}`}
                onClick={() => void resolve(alert)}
              >
                {busy === alert.id ? "Resolving…" : "Resolve"}
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className={EMPTY}>No active clinical alerts.</p>
      )}
      {resolved.length > 0 && (
        <div className="mt-3 border-t border-surface-border pt-3">
          <div className="mb-1.5 text-[11px] font-bold uppercase tracking-wide text-ink-400">
            Resolved
          </div>
          <ul className="flex flex-col gap-1.5">
            {resolved.map((alert) => (
              <li key={alert.id} className="text-xs text-ink-400">
                <span className="line-through">{alert.label}</span> · raised{" "}
                {formatDateTime(alert.raised_at)}
                {alert.raised_by && ` by ${alert.raised_by}`} · resolved{" "}
                {formatDateTime(alert.resolved_at)}
                {alert.resolved_by && ` by ${alert.resolved_by}`}
              </li>
            ))}
          </ul>
        </div>
      )}
    </Card>
  );
}
