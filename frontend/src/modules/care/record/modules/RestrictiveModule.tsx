import { useCallback, useEffect, useState } from "react";
import { useAuth } from "../../../../auth/useAuth";
import {
  completeRestrictiveCheck,
  debriefRestrictive,
  endRestrictive,
  listRestrictive,
  listSeniors,
  recordRestrictive,
  type RestrictiveEpisode,
} from "../../../../lib/carePathwayApi";
import { formatDateTime } from "../../shared/format";
import { BTN, BTN_GHOST, BTN_SM, FIELD_LABEL, INPUT } from "../../shared/styles";
import { Callout, ErrorNote, Tag } from "../../shared/ui";
import { errorText } from "../../triage/helpers";

const KINDS = [["SECLUSION", "Seclusion"], ["RESTRAINT", "Physical restraint"], ["RAPID_TRANQUILLISATION", "Rapid tranquillisation (IM)"]];
const INJURY = [["NONE", "No injury"], ["MINOR", "Minor injury — treated"], ["REVIEW", "Injury — medical review requested"]];

/** Restrictive practice — de-escalation first, an authoriser, timed checks and
 * debrief. The monitoring schedule comes from facility configuration. */
export function RestrictiveModule({ patientId }: { patientId: string }) {
  const { accessToken } = useAuth();
  const [rows, setRows] = useState<RestrictiveEpisode[]>([]);
  const [options, setOptions] = useState<string[]>([]);
  const [authorisers, setAuthorisers] = useState<{ id: string; name: string }[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({ kind: "", authorised_by: "", start_at: "", injury_check: "", incident_reference: "", staff_debrief_held: false });
  const [tried, setTried] = useState<string[]>([]);

  const load = useCallback(async () => {
    if (!accessToken) return;
    try {
      const r = await listRestrictive(accessToken, patientId);
      setRows(r.results);
      setOptions(r.de_escalation_options);
      setAuthorisers((await listSeniors(accessToken)).results);
    } catch (e) {
      setError(errorText(e, "Couldn't load restrictive-practice records."));
    }
  }, [accessToken, patientId]);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- fetch on mount.
    void load();
  }, [load]);

  const replace = (row: RestrictiveEpisode) => setRows((prev) => prev.map((r) => (r.id === row.id ? row : r)));
  async function act(work: () => Promise<RestrictiveEpisode>) {
    setError(null);
    try {
      replace(await work());
    } catch (e) {
      setError(errorText(e, "Couldn't save."));
    }
  }

  async function record() {
    if (!accessToken) return;
    setError(null);
    try {
      const created = await recordRestrictive(accessToken, patientId, { ...form, de_escalation: tried, start_at: form.start_at ? new Date(form.start_at).toISOString() : "" });
      setRows((prev) => [created, ...prev]);
      setTried([]);
      setForm({ kind: "", authorised_by: "", start_at: "", injury_check: "", incident_reference: "", staff_debrief_held: false });
    } catch (e) {
      setError(errorText(e, "Couldn't record the episode."));
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <ErrorNote>{error}</ErrorNote>
      <Callout tone="warning">Monitoring schedules are configured for the facility — follow the facility’s restrictive-practice policy. De-escalation must be tried and recorded first.</Callout>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <fieldset className="sm:col-span-2">
          <legend className={FIELD_LABEL}>De-escalation tried first <span className="text-priority-red">*</span></legend>
          <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1">
            {options.map((o) => (
              <label key={o} className="flex items-center gap-1.5 text-[13px]">
                <input type="checkbox" checked={tried.includes(o)} onChange={(e) => setTried((t) => (e.target.checked ? [...t, o] : t.filter((x) => x !== o)))} />
                {o}
              </label>
            ))}
          </div>
        </fieldset>
        <label className="flex flex-col gap-1"><span className={FIELD_LABEL}>Intervention</span>
          <select className={INPUT} value={form.kind} onChange={(e) => setForm((f) => ({ ...f, kind: e.target.value }))}><option value="">— select —</option>{KINDS.map(([c, l]) => (<option key={c} value={c}>{l}</option>))}</select></label>
        <label className="flex flex-col gap-1"><span className={FIELD_LABEL}>Authorised by</span>
          <select className={INPUT} value={form.authorised_by} onChange={(e) => setForm((f) => ({ ...f, authorised_by: e.target.value }))}><option value="">— select —</option>{authorisers.map((a) => (<option key={a.id} value={a.id}>{a.name}</option>))}</select></label>
        <label className="flex flex-col gap-1"><span className={FIELD_LABEL}>Start</span>
          <input type="datetime-local" className={INPUT} value={form.start_at} onChange={(e) => setForm((f) => ({ ...f, start_at: e.target.value }))} /></label>
        <label className="flex flex-col gap-1"><span className={FIELD_LABEL}>Injury check (client and staff)</span>
          <select className={INPUT} value={form.injury_check} onChange={(e) => setForm((f) => ({ ...f, injury_check: e.target.value }))}><option value="">— select —</option>{INJURY.map(([c, l]) => (<option key={c} value={c}>{l}</option>))}</select></label>
        <label className="flex flex-col gap-1"><span className={FIELD_LABEL}>Incident report number</span>
          <input className={INPUT} value={form.incident_reference} onChange={(e) => setForm((f) => ({ ...f, incident_reference: e.target.value }))} /></label>
        <label className="flex items-center gap-2 self-end text-[13px]"><input type="checkbox" checked={form.staff_debrief_held} onChange={(e) => setForm((f) => ({ ...f, staff_debrief_held: e.target.checked }))} /> Staff debrief held</label>
      </div>
      <div><button type="button" className={BTN} disabled={!tried.length || !form.kind || !form.authorised_by || !form.start_at || !form.injury_check} onClick={() => void record()}>Record episode</button></div>
      {rows.map((r) => (
        <div key={r.id} className="rounded-lg border border-surface-border p-3 text-[13px]">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-semibold">{r.kind_display}</span>
            <span className="text-ink-500">{formatDateTime(r.start_at)} {r.end_at ? `– ${formatDateTime(r.end_at)}` : "· ongoing"}</span>
            <Tag>authorised by {r.authorised_by}</Tag>
          </div>
          <p className="mt-1 text-ink-500">De-escalation: {r.de_escalation.join(", ")} · {r.injury_check}{r.incident_reference ? ` · incident ${r.incident_reference}` : ""}</p>
          {r.senior_review_due && <Callout tone="danger" role="alert" className="mt-2">Seclusion has reached the maximum duration — independent senior review is required now.</Callout>}
          {r.checks.map((c) => {
            const over = !c.done_at && new Date(c.due_at).getTime() < Date.now();
            return (
              <div key={c.id} className="mt-1 flex flex-wrap items-center gap-2">
                <Tag tone={c.done_at ? "brand" : over ? "risk" : "neutral"}>{formatDateTime(c.due_at)} · {c.label}{c.done_at ? ` · done ${c.done_by}` : over ? " · overdue" : ""}</Tag>
                {!c.done_at && <button type="button" className={`${BTN_GHOST} ${BTN_SM}`} onClick={() => accessToken && void act(() => completeRestrictiveCheck(accessToken, c.id))}>Record check</button>}
              </div>
            );
          })}
          <div className="mt-2 flex flex-wrap gap-2">
            {!r.client_debrief_at && <button type="button" className={`${BTN} ${BTN_SM}`} onClick={() => accessToken && void act(() => debriefRestrictive(accessToken, r.id))}>Client debrief done</button>}
            {!r.end_at && <button type="button" className={`${BTN_GHOST} ${BTN_SM}`} onClick={() => accessToken && void act(() => endRestrictive(accessToken, r.id))}>Record end</button>}
            {r.client_debrief_at && <Tag tone="brand">Client debrief {formatDateTime(r.client_debrief_at)}</Tag>}
          </div>
        </div>
      ))}
    </div>
  );
}
