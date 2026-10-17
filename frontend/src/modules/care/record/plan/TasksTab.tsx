import { useState } from "react";
import { useAuth } from "../../../../auth/useAuth";
import {
  listMdt,
  recordMdt,
  scheduleMdt,
  setPlanTaskDone,
  type MdtReviewRow,
  type PlanAction,
  type PlanWorkspace,
} from "../../../../lib/carePathwayApi";
import { formatDate, formatDateTime } from "../../shared/format";
import { errorText } from "../../triage/helpers";
import { BTN, BTN_GHOST, BTN_SM, FIELD_LABEL, INPUT } from "../../shared/styles";
import { Card, ErrorNote, Tag } from "../../shared/ui";
import { useRecordData } from "../useRecordData";

const MDT_LABELS = {
  notes: "Decisions",
  attendees: "Attendees",
  outcome: "Outcome",
  dissent: "Dissent / differing views (if any)",
} as const;

/** Tasks under each signed action (owner role, due time) and MDT reviews. */
export function TasksTab({
  patientId,
  ws,
  onTaskChanged,
}: {
  patientId: string;
  ws: PlanWorkspace;
  onTaskChanged: (action: PlanAction) => void;
}) {
  const { accessToken } = useAuth();
  const [error, setError] = useState<string | null>(null);
  const [version, setVersion] = useState(0);
  const mdt = useRecordData(patientId, version, (token) => listMdt(token, patientId), "Couldn't load MDT reviews.");
  const [day, setDay] = useState("");
  const [recording, setRecording] = useState<string | null>(null);
  const [form, setForm] = useState({ notes: "", attendees: "", outcome: "", dissent: "", next_review: "" });
  const live = ws.actions.filter((a) => a.decision && a.decision !== "DECLINED");

  async function toggle(task: PlanAction["tasks"][number], done: boolean) {
    if (!accessToken) return;
    try {
      onTaskChanged(await setPlanTaskDone(accessToken, task.id, done));
    } catch (e) {
      setError(errorText(e, "Couldn't update the task."));
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <ErrorNote>{error}</ErrorNote>
      {ws.version === 0 && <p className="text-[13px] text-ink-500">Tasks open once the plan is signed.</p>}
      {live.map((a) => (
        <Card key={a.id} title={a.name} aside={a.due_at ? <Tag>due {formatDateTime(a.due_at)}</Tag> : undefined}>
          {a.tasks.length === 0 ? (
            <p className="text-[13px] text-ink-500">No tasks yet.</p>
          ) : (
            <ul className="flex flex-col gap-1">
              {a.tasks.map((t) => (
                <li key={t.id} className="flex flex-wrap items-center gap-2 text-[13px]">
                  <label className="flex items-center gap-2">
                    <input type="checkbox" checked={Boolean(t.done_at)} onChange={(e) => void toggle(t, e.target.checked)} />
                    <span className={t.done_at ? "text-ink-500 line-through" : ""}>{t.label}</span>
                  </label>
                  <Tag>{t.owner_role}</Tag>
                  {t.done_at && <span className="text-[11px] text-ink-500">{t.done_by} · {formatDateTime(t.done_at)}</span>}
                </li>
              ))}
            </ul>
          )}
        </Card>
      ))}
      <Card title="Multidisciplinary reviews">
        <ErrorNote>{mdt.error}</ErrorNote>
        <ul className="flex flex-col gap-2">
          {(mdt.data?.results ?? []).map((r: MdtReviewRow) => (
            <li key={r.id} className="rounded-lg border border-surface-border p-2.5 text-[13px]">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-semibold">{formatDate(r.scheduled_for)}</span>
                <Tag tone={r.held_at ? "brand" : "warn"}>{r.held_at ? "held" : "scheduled"}</Tag>
              </div>
              {r.held_at ? (
                <>
                  <p className="mt-1 text-ink-900">{r.notes}{r.outcome ? ` — outcome: ${r.outcome}` : ""}</p>
                  {r.attendees && <p className="text-[12px] text-ink-500">{r.attendees}</p>}
                  {r.dissent && <p className="text-[12px] text-ink-900"><strong>Dissent:</strong> {r.dissent}</p>}
                </>
              ) : recording === r.id ? (
                <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
                  {(["notes", "attendees", "outcome", "dissent"] as const).map((k) => (
                    <label key={k} className={`flex flex-col gap-1 ${k === "notes" ? "sm:col-span-2" : ""}`}>
                      {/* eslint-disable-next-line security/detect-object-injection -- `k` is a typed union. */}
                      <span className={FIELD_LABEL}>{MDT_LABELS[k]}</span>
                      <input className={INPUT} value={form[k]} onChange={(e) => setForm((f) => ({ ...f, [k]: e.target.value }))} />
                    </label>
                  ))}
                  <label className="flex flex-col gap-1">
                    <span className={FIELD_LABEL}>Next review</span>
                    <input type="date" className={INPUT} value={form.next_review} onChange={(e) => setForm((f) => ({ ...f, next_review: e.target.value }))} />
                  </label>
                  <div className="flex items-end gap-2">
                    <button type="button" className={`${BTN} ${BTN_SM}`} disabled={!form.notes.trim()} onClick={() => accessToken && void recordMdt(accessToken, r.id, { ...form, next_review: form.next_review || undefined }).then(() => { setRecording(null); setVersion((v) => v + 1); }).catch((e) => setError(errorText(e, "Couldn't record the review.")))}>
                      Record review
                    </button>
                    <button type="button" className={`${BTN_GHOST} ${BTN_SM}`} onClick={() => setRecording(null)}>Cancel</button>
                  </div>
                </div>
              ) : (
                <button type="button" className={`${BTN_GHOST} ${BTN_SM} mt-1`} onClick={() => setRecording(r.id)}>Record this review</button>
              )}
            </li>
          ))}
        </ul>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <input type="date" aria-label="Review date" className={`${INPUT} max-w-[180px]`} value={day} onChange={(e) => setDay(e.target.value)} />
          <button type="button" className={`${BTN} ${BTN_SM}`} disabled={!day} onClick={() => accessToken && void scheduleMdt(accessToken, patientId, day).then(() => { setDay(""); setVersion((v) => v + 1); }).catch((e) => setError(errorText(e, "Couldn't schedule.")))}>
            Schedule review
          </button>
        </div>
      </Card>
    </div>
  );
}
