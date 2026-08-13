import { useState } from "react";
import { useAuth } from "../../auth/AuthContext";
import { useEnsureEncounter } from "../../clinical/useEnsureEncounter";
import { ApiError } from "../../lib/apiClient";
import {
  addDiagnosis,
  searchIcd11,
  signSoapNote,
  submitSoapNote,
  type Icd11Code,
} from "../../lib/clinicalApi";

const FIELD_CLASS =
  "rounded-sm border border-surface-border px-3 py-2 text-sm text-ink-900 outline-none focus:border-brand-green";
const LABEL_CLASS = "flex flex-col gap-1.5 text-sm font-medium text-ink-700";

/** Module 3 — SOAP notes + mandatory ICD-11 diagnosis coding, docs/07-CLINICAL-MODULES-SPEC.md §7.3. */
export function ClinicalEncounterPage() {
  const { accessToken } = useAuth();
  const { encounterId, patientName, error: encounterError } = useEnsureEncounter();

  const [soap, setSoap] = useState({ subjective: "", objective: "", assessment: "", plan: "" });
  const [savedNote, setSavedNote] = useState<{ id: string; is_locked: boolean } | null>(null);
  const [soapError, setSoapError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [signing, setSigning] = useState(false);

  const [icdQuery, setIcdQuery] = useState("");
  const [icdResults, setIcdResults] = useState<Icd11Code[]>([]);
  const [addedDiagnoses, setAddedDiagnoses] = useState<Icd11Code[]>([]);
  const [diagnosisError, setDiagnosisError] = useState<string | null>(null);

  if (encounterError) return <p className="text-status-red">{encounterError}</p>;
  if (!encounterId) return <p className="text-ink-500">Loading…</p>;

  const submitSoap = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!accessToken) return;
    setSoapError(null);
    setSaving(true);
    try {
      const note = await submitSoapNote(accessToken, encounterId, soap);
      setSavedNote({ id: note.id, is_locked: false });
    } catch (err) {
      setSoapError(err instanceof ApiError ? err.message : "Couldn't save the SOAP note.");
    } finally {
      setSaving(false);
    }
  };

  const sign = async () => {
    if (!accessToken || !savedNote) return;
    setSigning(true);
    try {
      await signSoapNote(accessToken, encounterId, savedNote.id);
      setSavedNote({ ...savedNote, is_locked: true });
    } catch {
      setSoapError("Couldn't sign the note.");
    } finally {
      setSigning(false);
    }
  };

  const runIcdSearch = async (query: string) => {
    setIcdQuery(query);
    if (!accessToken || query.length < 2) {
      setIcdResults([]);
      return;
    }
    setIcdResults(await searchIcd11(accessToken, query));
  };

  const addDx = async (code: Icd11Code) => {
    if (!accessToken) return;
    setDiagnosisError(null);
    try {
      await addDiagnosis(accessToken, encounterId, code.code, addedDiagnoses.length === 0);
      setAddedDiagnoses((prev) => [...prev, code]);
      setIcdQuery("");
      setIcdResults([]);
    } catch (err) {
      setDiagnosisError(err instanceof ApiError ? err.message : "Couldn't add that diagnosis.");
    }
  };

  return (
    <div className="flex flex-col gap-6">
      <div>
        <div className="mb-1.5 text-[11px] font-bold uppercase tracking-wide text-brand-green">
          Module 3 · Clinical Encounter &amp; Consultation (EHR)
        </div>
        <h1 className="font-display text-2xl font-bold text-ink-900">
          Clinical Encounter — {patientName}
        </h1>
      </div>

      <form
        onSubmit={submitSoap}
        className="rounded-lg border border-surface-border bg-surface-card p-6 shadow-sm"
      >
        <h2 className="mb-4 font-display text-base font-semibold text-ink-900">S.O.A.P. Note</h2>
        <fieldset
          disabled={savedNote?.is_locked}
          className="grid grid-cols-2 gap-4 disabled:opacity-60"
        >
          {(["subjective", "objective", "assessment", "plan"] as const).map((key) => (
            <label key={key} className={LABEL_CLASS}>
              {key[0].toUpperCase() + key.slice(1)}
              <textarea
                className={FIELD_CLASS}
                rows={3}
                // key comes from the fixed literal tuple above, never user input.
                // eslint-disable-next-line security/detect-object-injection
                value={soap[key]}
                onChange={(e) => setSoap((s) => ({ ...s, [key]: e.target.value }))}
              />
            </label>
          ))}
        </fieldset>
        {soapError && <p className="mt-4 text-sm text-status-red">{soapError}</p>}
        <div className="mt-4 flex gap-3">
          <button
            type="submit"
            disabled={saving || savedNote?.is_locked}
            className="rounded-md bg-brand-green px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-brand-green-dark disabled:opacity-60"
          >
            {saving ? "Saving…" : savedNote ? "Update Note" : "Save Note"}
          </button>
          {savedNote && !savedNote.is_locked && (
            <button
              type="button"
              onClick={sign}
              disabled={signing}
              className="rounded-md border border-surface-border bg-white px-4 py-2 text-sm font-semibold text-ink-700 hover:bg-surface-bg disabled:opacity-60"
            >
              {signing ? "Signing…" : "Sign & Lock"}
            </button>
          )}
          {savedNote?.is_locked && (
            <span className="self-center text-sm font-medium text-brand-green-dark">
              Signed and locked
            </span>
          )}
        </div>
      </form>

      <div className="rounded-lg border border-surface-border bg-surface-card p-6 shadow-sm">
        <h2 className="mb-4 font-display text-base font-semibold text-ink-900">
          Diagnoses{" "}
          <span className="text-xs font-normal text-ink-500">
            (ICD-11 — required, no free text)
          </span>
        </h2>
        <div className="relative max-w-md">
          <input
            className={FIELD_CLASS + " w-full"}
            placeholder="Search ICD-11, e.g. 'depress' or '6A70'…"
            value={icdQuery}
            onChange={(e) => runIcdSearch(e.target.value)}
          />
          {icdResults.length > 0 && (
            <ul className="absolute z-10 mt-1 w-full rounded-md border border-surface-border bg-white shadow-md">
              {icdResults.map((code) => (
                <li key={code.code}>
                  <button
                    type="button"
                    onClick={() => addDx(code)}
                    className="w-full px-3 py-2 text-left text-sm hover:bg-surface-bg"
                  >
                    <span className="font-mono text-xs text-ink-500">{code.code}</span>{" "}
                    {code.description}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
        {diagnosisError && <p className="mt-2 text-sm text-status-red">{diagnosisError}</p>}
        <ul className="mt-4 flex flex-col gap-2">
          {addedDiagnoses.map((code, i) => (
            <li key={code.code} className="flex items-center gap-2 text-sm text-ink-700">
              <span className="rounded-full bg-brand-green-tint px-2 py-0.5 text-xs font-semibold text-brand-green-dark">
                {i === 0 ? "Primary" : "Secondary"}
              </span>
              <span className="font-mono text-xs text-ink-500">{code.code}</span> {code.description}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
