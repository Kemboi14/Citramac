import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../../auth/useAuth";
import { usePatientContext } from "../../clinical/usePatientContext";
import {
  addNursingNote,
  administerMarEntry,
  listAdmissions,
  listMarEntries,
  listNursingNotes,
  scheduleMarEntry,
  type Admission,
  type MarStatus,
  type MedicationAdministration,
  type NursingNote,
} from "../../lib/ipdApi";

const FIELD_CLASS =
  "rounded-sm border border-surface-border px-3 py-2 text-sm text-ink-900 outline-none transition-colors duration-150 focus:border-brand-green";
const LABEL_CLASS = "flex flex-col gap-1.5 text-sm font-medium text-ink-700";
const BUTTON_CLASS =
  "rounded-md bg-brand-green px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-brand-green-dark active:scale-[0.98] disabled:opacity-60 disabled:active:scale-100 transition-all duration-150";

const MAR_TINT: Record<MarStatus, string> = {
  SCHEDULED: "bg-status-amber-tint text-status-amber",
  ADMINISTERED: "bg-brand-green-tint text-brand-green-dark",
  MISSED: "bg-status-red-tint text-status-red",
  REFUSED: "bg-status-red-tint text-status-red",
};

/**
 * Psychiatric Nursing — electronic MAR + nursing notes for the client's
 * active admission — docs/07-CLINICAL-MODULES-SPEC.md §7.7. Backend
 * (MedicationAdministration/NursingNote) already existed with zero
 * frontend before this.
 */
export function NursingCarePage() {
  const { accessToken } = useAuth();
  const { selected } = usePatientContext();

  const [admission, setAdmission] = useState<Admission | null>(null);
  const [marEntries, setMarEntries] = useState<MedicationAdministration[]>([]);
  const [notes, setNotes] = useState<NursingNote[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [scheduledTime, setScheduledTime] = useState("");
  const [shift, setShift] = useState<"DAY" | "NIGHT">("DAY");
  const [noteText, setNoteText] = useState("");

  const refresh = async () => {
    if (!accessToken || !selected) return;
    const admissions = await listAdmissions(accessToken);
    const active = admissions.results.find(
      (a) => a.patient === selected.patientId && a.status === "ADMITTED",
    );
    setAdmission(active ?? null);
    if (active) {
      const [mar, noteRes] = await Promise.all([
        listMarEntries(accessToken, active.id),
        listNursingNotes(accessToken, active.id),
      ]);
      setMarEntries(mar.results);
      setNotes(noteRes.results);
    } else {
      setMarEntries([]);
      setNotes([]);
    }
  };

  useEffect(() => {
    if (!accessToken || !selected) return;
    listAdmissions(accessToken)
      .then(async (admissions) => {
        const active = admissions.results.find(
          (a) => a.patient === selected.patientId && a.status === "ADMITTED",
        );
        setAdmission(active ?? null);
        if (!active) {
          setMarEntries([]);
          setNotes([]);
          return;
        }
        const [mar, noteRes] = await Promise.all([
          listMarEntries(accessToken, active.id),
          listNursingNotes(accessToken, active.id),
        ]);
        setMarEntries(mar.results);
        setNotes(noteRes.results);
      })
      .catch(() => setError("Couldn't load nursing records."));
  }, [accessToken, selected]);

  if (!selected) {
    return (
      <p className="text-ink-500">
        Select a client from the{" "}
        <Link to="/clinical/registry" className="font-semibold text-brand-green hover:underline">
          Client Registry
        </Link>{" "}
        first.
      </p>
    );
  }

  if (!admission) {
    return (
      <p className="text-ink-500">
        {selected.patientName} has no active admission. Start one from{" "}
        <Link to="/clinical/ipd" className="font-semibold text-brand-green hover:underline">
          Inpatient &amp; Ward / Admission
        </Link>
        .
      </p>
    );
  }

  const schedule = async () => {
    if (!accessToken || !scheduledTime) return;
    setBusy(true);
    setError(null);
    try {
      await scheduleMarEntry(accessToken, {
        admission: admission.id,
        scheduled_time: new Date(scheduledTime).toISOString(),
      });
      setScheduledTime("");
      refresh();
    } catch {
      setError("Couldn't schedule the MAR entry.");
    } finally {
      setBusy(false);
    }
  };

  const administer = async (entryId: string, status: MarStatus) => {
    if (!accessToken) return;
    await administerMarEntry(accessToken, entryId, status);
    refresh();
  };

  const addNote = async () => {
    if (!accessToken || !noteText.trim()) return;
    setBusy(true);
    try {
      await addNursingNote(accessToken, { admission: admission.id, shift, note: noteText });
      setNoteText("");
      refresh();
    } catch {
      setError("Couldn't save the nursing note.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-6 animate-fade-in">
      <div>
        <div className="mb-1.5 text-[11px] font-bold uppercase tracking-wide text-brand-green">
          Psychiatric Nursing
        </div>
        <h1 className="font-display text-2xl font-bold text-ink-900">
          Nursing Care — {selected.patientName}
        </h1>
      </div>

      <div className="rounded-lg border border-surface-border bg-surface-card p-6 shadow-sm">
        <h2 className="mb-4 font-display text-base font-semibold text-ink-900">
          Medication Administration Record
        </h2>
        <div className="mb-4 flex items-end gap-3">
          <label className={LABEL_CLASS}>
            Schedule time
            <input
              type="datetime-local"
              className={FIELD_CLASS}
              value={scheduledTime}
              onChange={(e) => setScheduledTime(e.target.value)}
            />
          </label>
          <button
            type="button"
            disabled={busy || !scheduledTime}
            className={BUTTON_CLASS}
            onClick={schedule}
          >
            Schedule
          </button>
        </div>
        {marEntries.length === 0 && <p className="text-sm text-ink-500">No MAR entries yet.</p>}
        {marEntries.map((entry) => (
          <div
            key={entry.id}
            className="flex items-center gap-3 border-t border-surface-bg py-2.5 transition-colors duration-150 first:border-t-0 hover:bg-brand-green-tint-2"
          >
            <span className="flex-1 text-sm text-ink-700">
              {new Date(entry.scheduled_time).toLocaleString([], {
                dateStyle: "medium",
                timeStyle: "short",
              })}
            </span>
            <span
              className={`rounded-full px-2.5 py-1 text-[10px] font-semibold ${MAR_TINT[entry.status]}`}
            >
              {entry.status}
            </span>
            {entry.status === "SCHEDULED" && (
              <div className="flex gap-1.5">
                <button
                  type="button"
                  className="rounded-sm border border-surface-border px-2 py-1 text-[11px] font-semibold text-ink-700 hover:bg-brand-green-tint-2"
                  onClick={() => administer(entry.id, "ADMINISTERED")}
                >
                  Administered
                </button>
                <button
                  type="button"
                  className="rounded-sm border border-surface-border px-2 py-1 text-[11px] font-semibold text-status-red hover:bg-status-red-tint"
                  onClick={() => administer(entry.id, "REFUSED")}
                >
                  Refused
                </button>
              </div>
            )}
          </div>
        ))}
      </div>

      <div className="rounded-lg border border-surface-border bg-surface-card p-6 shadow-sm">
        <h2 className="mb-4 font-display text-base font-semibold text-ink-900">Nursing Notes</h2>
        <div className="mb-4 flex items-end gap-3">
          <label className={LABEL_CLASS}>
            Shift
            <select
              className={FIELD_CLASS}
              value={shift}
              onChange={(e) => setShift(e.target.value as "DAY" | "NIGHT")}
            >
              <option value="DAY">Day</option>
              <option value="NIGHT">Night</option>
            </select>
          </label>
          <label className={`${LABEL_CLASS} flex-1`}>
            Note
            <textarea
              className={FIELD_CLASS}
              rows={2}
              value={noteText}
              onChange={(e) => setNoteText(e.target.value)}
            />
          </label>
          <button
            type="button"
            disabled={busy || !noteText.trim()}
            className={BUTTON_CLASS}
            onClick={addNote}
          >
            Add note
          </button>
        </div>
        {notes.length === 0 && <p className="text-sm text-ink-500">No nursing notes yet.</p>}
        {notes.map((note) => (
          <div
            key={note.id}
            className="border-t border-surface-bg py-2.5 transition-colors duration-150 first:border-t-0 hover:bg-brand-green-tint-2"
          >
            <p className="text-sm text-ink-700">{note.note}</p>
            <p className="mt-1 text-xs text-ink-500">
              {note.shift} shift · {new Date(note.recorded_at).toLocaleString()}
            </p>
          </div>
        ))}
      </div>

      {error && (
        <p className="rounded-sm bg-status-red-tint px-3 py-2 text-sm text-status-red">{error}</p>
      )}
    </div>
  );
}
