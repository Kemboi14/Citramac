import { useEffect, useId, useState } from "react";
import { useAuth } from "../../../auth/useAuth";
import { ApiError } from "../../../lib/apiClient";
import { searchIcd11, type Icd11Code } from "../../../lib/clinicalApi";
import { createDiagnosis, listDiagnosesForPatient } from "../../../lib/diagnosesApi";
import { formatDateTime } from "../shared/format";
import { BTN, INPUT, TABLE, TD, TH } from "../shared/styles";
import { Callout, Card, ErrorNote, Field, Tag } from "../shared/ui";
import { useRecordData } from "./useRecordData";

/**
 * Diagnosis tab — ICD-11 search only, no free-text diagnosis (CLAUDE.md §3.3,
 * conflict C4). Each diagnosis hangs off the psychiatry encounter.
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
      });
      setSavedNote(`Added ${selected.code} — ${selected.description}.`);
      setSelected(null);
      setPrimary(false);
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

  return (
    <div className="flex flex-col gap-4">
      <Card title="Diagnoses" bodyClassName="p-0">
        <ErrorNote>{error}</ErrorNote>
        <div className="overflow-x-auto">
          <table className={`${TABLE} min-w-[560px]`}>
            <thead>
              <tr>
                <th className={TH}>ICD-11</th>
                <th className={TH}>Description</th>
                <th className={TH}>Status</th>
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
                    </td>
                    <td className={TD}>
                      <Tag>{d.status.charAt(0) + d.status.slice(1).toLowerCase()}</Tag>
                    </td>
                    <td className={`${TD} whitespace-nowrap font-mono text-xs`}>
                      {formatDateTime(d.noted_at)}
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={4} className={`${TD} py-6 text-center text-ink-500`}>
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
