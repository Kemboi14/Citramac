import { useEffect, useState } from "react";
import { useAuth } from "../../../../auth/useAuth";
import {
  addMedicationHistory,
  listMedicationHistory,
  retireMedicationHistory,
  type IntakeSectionSpec,
  type MedicationHistoryRow,
} from "../../../../lib/carePathwayApi";
import { errorText } from "../../triage/helpers";
import { BTN, BTN_GHOST, BTN_SM, GROUP_LABEL, INPUT, TABLE, TD, TH } from "../../shared/styles";
import { Callout, ErrorNote } from "../../shared/ui";
import type { ValueSetsApi } from "../../shared/useValueSets";
import type { SectionValues } from "./fields";
import { SchemaSection } from "./SchemaSection";

const BLANK = { name: "", dose: "", frequency: "", route: "", reason: "" };

/** Section 5 — the one shared, structured medication list (same list used by
 * prescribing, the MAR and discharge). Confirm / update rather than re-enter. */
export function MedsSection({
  patientId,
  spec,
  values,
  vs,
  onChange,
  onListChanged,
}: {
  patientId: string;
  spec: IntakeSectionSpec;
  values: SectionValues;
  vs: ValueSetsApi;
  onChange: (key: string, value: unknown) => void;
  onListChanged: () => void;
}) {
  const { accessToken } = useAuth();
  const [rows, setRows] = useState<MedicationHistoryRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState(BLANK);

  useEffect(() => {
    if (!accessToken) return;
    let cancelled = false;
    listMedicationHistory(accessToken, patientId)
      .then((r) => !cancelled && setRows(r.results))
      .catch((e) => !cancelled && setError(errorText(e, "Couldn't load the medication list.")));
    return () => {
      cancelled = true;
    };
  }, [accessToken, patientId]);

  async function add() {
    if (!accessToken || !draft.name.trim()) return;
    setError(null);
    try {
      const created = await addMedicationHistory(accessToken, patientId, {
        ...draft,
        name: draft.name.trim(),
        source: "Intake",
      });
      setRows((prev) => [...(prev ?? []), created]);
      setDraft(BLANK);
      onListChanged();
    } catch (e) {
      setError(errorText(e, "Couldn't add the medication."));
    }
  }

  async function retire(id: string) {
    if (!accessToken) return;
    try {
      await retireMedicationHistory(accessToken, id);
      setRows((prev) => (prev ?? []).filter((r) => r.id !== id));
      onListChanged();
    } catch (e) {
      setError(errorText(e, "Couldn't retire the medication."));
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <Callout>
        One shared, structured medication list — the same list used by prescribing, the MAR and the
        discharge summary. <strong>Confirm / update rather than re-enter.</strong>
      </Callout>
      <ErrorNote>{error}</ErrorNote>
      <div className="overflow-x-auto">
        <table className={TABLE}>
          <thead>
            <tr>
              <th className={TH}>Medication</th>
              <th className={TH}>Dose</th>
              <th className={TH}>Frequency</th>
              <th className={TH}>Route</th>
              <th className={TH}>Source</th>
              <th className={TH}>
                <span className="sr-only">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {(rows ?? []).length === 0 && (
              <tr>
                <td className={TD} colSpan={6}>
                  {rows ? "No medications recorded yet." : "Loading…"}
                </td>
              </tr>
            )}
            {(rows ?? []).map((row) => (
              <tr key={row.id}>
                <td className={TD}>{row.name}</td>
                <td className={TD}>{row.dose}</td>
                <td className={TD}>{row.frequency}</td>
                <td className={TD}>{row.route}</td>
                <td className={TD}>{row.source}</td>
                <td className={TD}>
                  <button type="button" className={`${BTN_GHOST} ${BTN_SM}`} onClick={() => void retire(row.id)}>
                    Stopped / remove
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-5">
        {(["name", "dose", "frequency", "route", "reason"] as const).map((key) => (
          <input
            key={key}
            className={INPUT}
            aria-label={key === "name" ? "Medication name" : key}
            placeholder={key === "name" ? "Medication" : key[0].toUpperCase() + key.slice(1)}
            // eslint-disable-next-line security/detect-object-injection -- fixed key union.
            value={draft[key]}
            onChange={(e) => setDraft((d) => ({ ...d, [key]: e.target.value }))}
          />
        ))}
      </div>
      <div>
        <button type="button" className={BTN} disabled={!draft.name.trim()} onClick={() => void add()}>
          Add to list
        </button>
      </div>
      <div className={GROUP_LABEL}>Reconciliation</div>
      <SchemaSection spec={spec} values={values} vs={vs} onChange={onChange} />
    </div>
  );
}
