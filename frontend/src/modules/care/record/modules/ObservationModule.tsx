import { useCallback, useEffect, useState } from "react";
import { useAuth } from "../../../../auth/useAuth";
import {
  addObservationEntry,
  getObservation,
  getObservationConfig,
  handOverObserver,
  recordObservationSet,
  setObservationLevel,
  type ObservationConfig,
  type ObservationState,
} from "../../../../lib/carePathwayApi";
import { formatDateTime } from "../../shared/format";
import { BTN, BTN_GHOST, BTN_SM, FIELD_LABEL, INPUT, TABLE, TD, TH } from "../../shared/styles";
import { Callout, ErrorNote, Tag } from "../../shared/ui";
import { errorText } from "../../triage/helpers";

const VITALS = [
  { key: "heart_rate", label: "Heart rate", unit: "bpm" },
  { key: "systolic_bp", label: "Systolic BP", unit: "mmHg" },
  { key: "diastolic_bp", label: "Diastolic BP", unit: "mmHg" },
  { key: "respiratory_rate", label: "Respiratory rate", unit: "/min" },
  { key: "temperature_c", label: "Temperature", unit: "°C" },
  { key: "spo2", label: "SpO₂", unit: "%" },
  { key: "blood_glucose_mmol", label: "Glucose", unit: "mmol/L" },
] as const;
const REASONS = ["Declined", "Too agitated / unsafe to measure", "Equipment unavailable", "Not clinically indicated now"];
const ACVPU = [["A", "A — alert"], ["C", "C — new confusion"], ["V", "V — responds to voice"], ["P", "P — responds to pain"], ["U", "U — unresponsive"]];

/** Observation level, signed observation entries, observer hand-over and full
 * observation sets (the early warning score is computed on the server). */
export function ObservationModule({ patientId }: { patientId: string }) {
  const { accessToken } = useAuth();
  const [config, setConfig] = useState<ObservationConfig | null>(null);
  const [state, setState] = useState<ObservationState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [level, setLevel] = useState("");
  const [reason, setReason] = useState("");
  const [observer, setObserver] = useState({ name: "", gender: "" });
  const [entry, setEntry] = useState({ location: "", engagement: "", note: "" });
  const [vit, setVit] = useState<Record<string, string>>({});
  const [skip, setSkip] = useState<Record<string, string>>({});
  const [avpu, setAvpu] = useState("");
  const [o2, setO2] = useState(false);
  const [result, setResult] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!accessToken) return;
    try {
      const [c, s] = await Promise.all([getObservationConfig(accessToken), getObservation(accessToken, patientId)]);
      setConfig(c);
      setState(s);
    } catch (e) {
      setError(errorText(e, "Couldn't load observation."));
    }
  }, [accessToken, patientId]);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- fetch on mount.
    void load();
  }, [load]);

  async function run(work: () => Promise<ObservationState>, done?: () => void) {
    setError(null);
    try {
      setState(await work());
      done?.();
    } catch (e) {
      setError(errorText(e, "Couldn't save."));
    }
  }

  async function saveSet() {
    if (!accessToken) return;
    setError(null);
    setResult(null);
    try {
      const body = {
        ...Object.fromEntries(Object.entries(vit).filter(([, v]) => v !== "")),
        consciousness: avpu || undefined,
        supplemental_o2: o2 || undefined,
        not_measured: Object.keys(skip).length ? skip : undefined,
      };
      const saved = await recordObservationSet(accessToken, patientId, body);
      setResult(`${saved.ews?.label ?? "Recorded"} — ${saved.ews?.response.text ?? ""}${saved.warnings.length ? " · " + saved.warnings.join(" ") : ""}`);
      setVit({});
      setSkip({});
      setAvpu("");
      setO2(false);
    } catch (e) {
      setError(errorText(e, "Couldn't record the observations."));
    }
  }

  if (!config || !state) return error ? <ErrorNote>{error}</ErrorNote> : <p className="text-[13px] text-ink-500">Loading…</p>;
  return (
    <div className="flex flex-col gap-4">
      <ErrorNote>{error}</ErrorNote>
      {config.approval === "illustrative" && (
        <Callout tone="warning">Observation intervals and the continuous-observation limit are illustrative — follow the facility’s observation policy.</Callout>
      )}
      <div className="flex flex-wrap items-center gap-2 text-[13px]">
        {state.level ? (
          <Tag tone={state.level.code === "GENERAL_HOURLY" ? "neutral" : "warn"}>{state.level.display}</Tag>
        ) : (
          <Tag tone="warn">No level set</Tag>
        )}
        {state.next_entry_due && <Tag tone={state.overdue ? "risk" : "neutral"}>next entry {state.overdue ? "OVERDUE — due " : ""}{formatDateTime(state.next_entry_due)}</Tag>}
        {state.observer && <Tag>Observer: {state.observer.name} since {formatDateTime(state.observer.since)}</Tag>}
        {state.rotation_overdue && <Tag tone="risk">Rotation due — continuous for over {config.max_continuous_minutes} min</Tag>}
      </div>

      <div>
        <div className={FIELD_LABEL}>Change level</div>
        <div className="mt-1 flex flex-wrap items-center gap-2">
          <select className={`${INPUT} max-w-xs`} aria-label="Observation level" value={level} onChange={(e) => setLevel(e.target.value)}>
            <option value="">— choose —</option>
            {config.levels.map((l) => (
              <option key={l.code} value={l.code}>{l.display}</option>
            ))}
          </select>
          <input className={`${INPUT} max-w-md`} aria-label="Reason" placeholder="Reason for change / step-down review" value={reason} onChange={(e) => setReason(e.target.value)} />
          <button type="button" className={`${BTN_GHOST} ${BTN_SM}`} disabled={!level || !reason.trim()} onClick={() => accessToken && void run(() => setObservationLevel(accessToken, patientId, level, reason), () => { setLevel(""); setReason(""); })}>
            Change level
          </button>
        </div>
      </div>

      {!state.level && (
        <Callout tone="warning">No observation level is set. Set the observation level at triage first (or above, with a reason) — observer hand-over and signed entries open once a level exists.</Callout>
      )}

      {state.level && (<>
      <div>
        <div className={FIELD_LABEL}>Observer hand-over</div>
        <div className="mt-1 flex flex-wrap items-center gap-2">
          <input className={`${INPUT} max-w-xs`} aria-label="Incoming observer" placeholder="Incoming observer name" value={observer.name} onChange={(e) => setObserver((o) => ({ ...o, name: e.target.value }))} />
          <select className={`${INPUT} max-w-[140px]`} aria-label="Observer gender" value={observer.gender} onChange={(e) => setObserver((o) => ({ ...o, gender: e.target.value }))}>
            <option value="">Gender</option>
            <option>Female</option>
            <option>Male</option>
          </select>
          <button type="button" className={`${BTN_GHOST} ${BTN_SM}`} disabled={!observer.name.trim()} onClick={() => accessToken && void run(() => handOverObserver(accessToken, patientId, observer.name, observer.gender), () => setObserver({ name: "", gender: "" }))}>
            Record hand-over
          </button>
        </div>
      </div>

      <div>
        <div className={FIELD_LABEL}>Signed observation entry</div>
        <div className="mt-1 grid grid-cols-1 gap-2 sm:grid-cols-2">
          <select className={INPUT} aria-label="Location" value={entry.location} onChange={(e) => setEntry((x) => ({ ...x, location: e.target.value }))}>
            <option value="">— location —</option>
            {config.locations.map((l) => (
              <option key={l}>{l}</option>
            ))}
          </select>
          <select className={INPUT} aria-label="Engagement" value={entry.engagement} onChange={(e) => setEntry((x) => ({ ...x, engagement: e.target.value }))}>
            <option value="">— engagement —</option>
            {config.engagement.map((l) => (
              <option key={l}>{l}</option>
            ))}
          </select>
          <input className={`${INPUT} sm:col-span-2`} aria-label="What you observed" placeholder="What you observed (behaviour, mood, what you talked about)" value={entry.note} onChange={(e) => setEntry((x) => ({ ...x, note: e.target.value }))} />
        </div>
        {!entry.note.trim() && !entry.engagement.startsWith("Asleep") && (
          <p className="mt-1 text-[11px] text-ink-500">Describe what you observed — only a client observed asleep may be signed without a note.</p>
        )}
        <button type="button" className={`${BTN} ${BTN_SM} mt-2`} disabled={!entry.location || (!entry.note.trim() && !entry.engagement.startsWith("Asleep"))} onClick={() => accessToken && void run(() => addObservationEntry(accessToken, patientId, entry), () => setEntry({ location: "", engagement: "", note: "" }))}>
          Sign observation entry
        </button>
        {state.entries.length > 0 && (
          <div className="mt-2 overflow-x-auto">
            <table className={TABLE}>
              <thead><tr><th className={TH}>Time</th><th className={TH}>Location</th><th className={TH}>Engagement</th><th className={TH}>Observation</th><th className={TH}>By</th></tr></thead>
              <tbody>
                {state.entries.slice(0, 6).map((e) => (
                  <tr key={e.id}><td className={TD}>{formatDateTime(e.at)}</td><td className={TD}>{e.location}</td><td className={TD}>{e.engagement || "—"}</td><td className={TD}>{e.note}</td><td className={TD}>{e.by}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
      </>)}

      <div>
        <div className={FIELD_LABEL}>Observation set (vital signs)</div>
        <p className="text-[11px] text-ink-500">Leave a box blank if it was not measured — a blank is never scored as normal; say why if you can.</p>
        <div className="mt-1 grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-4">
          {VITALS.map((v) => (
            <div key={v.key} className="flex flex-col gap-1 rounded-md border border-surface-border p-2">
              <label className="text-[11px] font-semibold text-ink-900" htmlFor={`vit-${v.key}`}>{v.label} <span className="font-normal text-ink-500">{v.unit}</span></label>
              <input id={`vit-${v.key}`} type="number" step="any" className={INPUT} value={vit[v.key] ?? ""} onChange={(e) => setVit((x) => ({ ...x, [v.key]: e.target.value }))} />
              {!vit[v.key] && (
                <select aria-label={`${v.label} not measured reason`} className={INPUT} value={skip[v.key] ?? ""} onChange={(e) => setSkip((x) => { const n = { ...x }; if (e.target.value) n[v.key] = e.target.value; else delete n[v.key]; return n; })}>
                  <option value="">Not recorded</option>
                  {REASONS.map((r) => (<option key={r}>{r}</option>))}
                </select>
              )}
            </div>
          ))}
          <div className="flex flex-col gap-1 rounded-md border border-surface-border p-2">
            <label className="text-[11px] font-semibold" htmlFor="vit-avpu">Consciousness (ACVPU)</label>
            <select id="vit-avpu" className={INPUT} value={avpu} onChange={(e) => setAvpu(e.target.value)}>
              <option value="">— not recorded —</option>
              {ACVPU.map(([c, l]) => (<option key={c} value={c}>{l}</option>))}
            </select>
            <label className="flex items-center gap-2 text-[12px]"><input type="checkbox" checked={o2} onChange={(e) => setO2(e.target.checked)} /> Supplemental O₂</label>
          </div>
        </div>
        <button type="button" className={`${BTN} ${BTN_SM} mt-2`} disabled={!Object.values(vit).some(Boolean) && !avpu} onClick={() => void saveSet()}>
          Record observations
        </button>
        {result && <Callout className="mt-2" role="status">{result}</Callout>}
      </div>
    </div>
  );
}
