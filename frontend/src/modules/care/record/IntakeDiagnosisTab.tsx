import { useEffect, useId, useState } from "react";
import { useAuth } from "../../../auth/useAuth";
import { ApiError } from "../../../lib/apiClient";
import { searchIcd11, type Icd11Code } from "../../../lib/clinicalApi";
import {
  createDiagnosis,
  listDiagnosesForPatient,
  updateDiagnosis,
  type Diagnosis,
  type DiagnosisStatus,
  type DiagnosisVerification,
} from "../../../lib/diagnosesApi";
import { formatDateTime } from "../shared/format";
import { BTN, INPUT, TABLE, TD, TH } from "../shared/styles";
import { Callout, Card, ErrorNote, Field, SelectChoices, Tag } from "../shared/ui";
import { useValueSets } from "../shared/useValueSets";
import { useRecordData } from "./useRecordData";

const CLINICAL_STATUSES: { code: DiagnosisStatus; display: string }[] = [
  { code: "ACTIVE", display: "Active" },
  { code: "HISTORICAL", display: "Historical" },
  { code: "RESOLVED", display: "Resolved" },
];
const CELL = "rounded-lg border border-surface-border bg-surface-bg px-2 py-1 text-[12.5px]";

/**
 * Diagnosis tab — ICD-11 search only, no free-text diagnosis (CLAUDE.md §3.3,
 * conflict C4). Each diagnosis hangs off the psychiatry encounter. Diagnostic
 * certainty (Provisional / Differential / Confirmed / Ruled out — the served
 * `intake-dx-status`, FHIR Condition.verificationStatus) is kept separate from
 * the clinical status (active / historical / resolved). Nothing is pre-assigned.
 */
export function IntakeDiagnosisTab({
  patientId,
  encounterId,
  onChanged,
}: {
  patientId: string;
  encounterId: string | null;
  onChanged: () => void;
}) {
  const { accessToken } = useAuth();
  const searchId = useId();
  const [version, setVersion] = useState(0);
  const { data, error, loading } = useRecordData(
    patientId,
    version,
    (token) => listDiagnosesForPatient(token, patientId),
    "Couldn't load diagnoses.",
  );
  const [query, setQuery] = useState("");
  const [found, setFound] = useState<{ query: string; results: Icd11Code[] } | null>(null);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Icd11Code | null>(null);
  const [primary, setPrimary] = useState(false);
  const [certainty, setCertainty] = useState<DiagnosisVerification>("PROVISIONAL");
  const [specifier, setSpecifier] = useState("");
  const vs = useValueSets();
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [savedNote, setSavedNote] = useState<string | null>(null);

  const term = query.trim();
  useEffect(() => {
    if (!accessToken || term.length < 2) return;
    let cancelled = false;
    const timer = window.setTimeout(() => {
      searchIcd11(accessToken, term)
        .then((results) => {
          if (cancelled) return;
          setFound({ query: term, results });
          setSearchError(null);
        })
        .catch((err) => {
          if (cancelled) return;
          setSearchError(err instanceof ApiError ? err.message : "ICD-11 search failed.");
        });
    }, 300);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [accessToken, term]);
  const results = term.length >= 2 && found?.query === term ? found.results : [];

  const add = async () => {
    if (!accessToken || !encounterId || !selected) return;
    setSaving(true);
    setSaveError(null);
    setSavedNote(null);
    try {
      await createDiagnosis(accessToken, {
        encounter: encounterId,
        icd11_code: selected.code,
        is_primary: primary,
        verification_status: certainty,
        clinical_notes: specifier.trim(),
      });
      setSavedNote(`Added ${selected.code} — ${selected.description}.`);
      setSelected(null);
      setPrimary(false);
      setCertainty("PROVISIONAL");
      setSpecifier("");
      setQuery("");
      setVersion((v) => v + 1);
      onChanged();
    } catch (err) {
      setSaveError(err instanceof ApiError ? err.message : "Couldn't add the diagnosis.");
    } finally {
      setSaving(false);
    }
  };

  const diagnoses = data?.results ?? [];
  const change = async (d: Diagnosis, body: Partial<Diagnosis>) => {
    if (!accessToken) return;
    setSaveError(null);
    try {
      await updateDiagnosis(accessToken, d.id, body);
      setVersion((v) => v + 1);
      onChanged();
    } catch (err) {
      setSaveError(err instanceof ApiError ? err.message : "Couldn't update the diagnosis.");
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <Callout>
        Diagnoses are recorded after assessment — nothing is pre-assigned. Use <strong>provisional</strong> or{" "}
        <strong>differential</strong> until organic causes are excluded; record comorbidity as separate entries.
      </Callout>
      <Card title="Diagnoses" bodyClassName="p-0">
        <ErrorNote>{error}</ErrorNote>
        <div className="overflow-x-auto">
          <table className={`${TABLE} min-w-[560px]`}>
            <thead>
              <tr>
                <th className={TH}>ICD-11</th>
                <th className={TH}>Description</th>
                <th className={TH}>Certainty</th>
                <th className={TH}>Clinical status</th>
                <th className={TH}>Noted</th>
              </tr>
            </thead>
            <tbody>
              {diagnoses.length > 0 ? (
                diagnoses.map((d) => (
                  <tr key={d.id}>
                    <td className={`${TD} font-mono text-xs font-semibold`}>{d.icd11_code}</td>
                    <td className={TD}>
                      {d.icd11_description} {d.is_primary && <Tag tone="brand">Primary</Tag>}
                      <input
                        className={`${CELL} mt-1 block w-full`}
                        aria-label={`Specifier / note for ${d.icd11_code}`}
                        placeholder="Specifier / note"
                        defaultValue={d.clinical_notes}
                        onBlur={(e) => e.target.value.trim() !== d.clinical_notes && void change(d, { clinical_notes: e.target.value.trim() })}
                      />
                    </td>
                    <td className={TD}>
                      <select
                        className={CELL}
                        aria-label={`Certainty of ${d.icd11_code}`}
                        value={d.verification_status}
                        onChange={(e) => void change(d, { verification_status: e.target.value as DiagnosisVerification })}
                      >
                        {!d.verification_status && <option value="">Not recorded</option>}
                        {vs.options("intake-dx-status").map((o) => (
                          <option key={o.code} value={o.code}>
                            {o.display}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className={TD}>
                      <select
                        className={CELL}
                        aria-label={`Clinical status of ${d.icd11_code}`}
                        value={d.status}
                        onChange={(e) => void change(d, { status: e.target.value as DiagnosisStatus })}
                      >
                        {CLINICAL_STATUSES.map((s) => (
                          <option key={s.code} value={s.code}>
                            {s.display}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className={`${TD} whitespace-nowrap font-mono text-xs`}>
                      {formatDateTime(d.noted_at)}
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={5} className={`${TD} py-6 text-center text-ink-500`}>
                    {loading && !data
                      ? "Loading diagnoses…"
                      : "No diagnoses recorded for this client yet."}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>

      <Card title="Add diagnosis (ICD-11)">
        {!encounterId ? (
          <Callout role="status">
            Open the review from the Psychiatric queue first — a diagnosis is recorded against the
            psychiatry encounter.
          </Callout>
        ) : (
          <div className="flex flex-col gap-3">
            <Field label="Search ICD-11" htmlFor={searchId}>
              <input
                id={searchId}
                type="search"
                className={INPUT}
                value={query}
                autoComplete="off"
                placeholder="Type at least 2 characters — code or term"
                onChange={(e) => {
                  setQuery(e.target.value);
                  setSelected(null);
                }}
              />
            </Field>
            <ErrorNote>{searchError}</ErrorNote>
            {results.length > 0 && !selected && (
              <ul
                aria-label="ICD-11 matches"
                className="max-h-60 overflow-auto rounded-lg border border-surface-border"
              >
                {results.map((code) => (
                  <li key={code.code}>
                    <button
                      type="button"
                      className="flex w-full gap-2 border-b border-surface-border px-3 py-2 text-left text-[13px] text-ink-900 last:border-b-0 hover:bg-surface-bg"
                      onClick={() => setSelected(code)}
                    >
                      <span className="font-mono text-xs font-semibold text-brand-green">
                        {code.code}
                      </span>
                      <span>{code.description}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
            {term.length >= 2 && found?.query === term && results.length === 0 && (
              <p className="text-xs text-ink-500">No ICD-11 matches for “{term}”.</p>
            )}
            {selected && (
              <p className="text-[13px] text-ink-900">
                Selected: <span className="font-mono font-semibold">{selected.code}</span> —{" "}
                {selected.description}
              </p>
            )}
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-[200px_1fr]">
              <label className="flex flex-col gap-1 text-[11px] font-semibold uppercase text-ink-500">
                Certainty
                <SelectChoices
                  options={vs.options("intake-dx-status").filter((o) => o.code !== "RULED_OUT")}
                  value={certainty}
                  onChange={(code) => setCertainty(code as DiagnosisVerification)}
                />
              </label>
              <label className="flex flex-col gap-1 text-[11px] font-semibold uppercase text-ink-500">
                Specifier / note
                <input
                  className={INPUT}
                  placeholder="e.g. current episode severe; in early remission"
                  value={specifier}
                  onChange={(e) => setSpecifier(e.target.value)}
                />
              </label>
            </div>
            <label className="flex items-center gap-2 text-[13px] text-ink-900">
              <input
                type="checkbox"
                className="h-[17px] w-[17px] accent-[var(--green)]"
                checked={primary}
                onChange={(e) => setPrimary(e.target.checked)}
              />
              Primary diagnosis
            </label>
            <ErrorNote>{saveError}</ErrorNote>
            {savedNote && (
              <p role="status" className="text-xs font-semibold text-brand-green">
                {savedNote}
              </p>
            )}
            <div>
              <button
                type="button"
                className={BTN}
                disabled={!selected || saving}
                onClick={() => void add()}
              >
                {saving ? "Adding…" : "Add diagnosis"}
              </button>
            </div>
          </div>
        )}
      </Card>
    </div>
  );
}
