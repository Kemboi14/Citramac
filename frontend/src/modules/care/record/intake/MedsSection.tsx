import { useEffect, useState } from "react";
import { useAuth } from "../../../../auth/useAuth";
import {
  addMedicationHistory,
  getIntakeAllergy,
  listMedicationHistory,
  retireMedicationHistory,
  updateMedicationHistory,
  type IntakeAllergy,
  type IntakeSectionSpec,
  type MedicationHistoryRow,
} from "../../../../lib/carePathwayApi";
import { errorText } from "../../triage/helpers";
import {
  BTN,
  BTN_GHOST,
  BTN_SM,
  FIELD_LABEL,
  GROUP_LABEL,
  INPUT,
  TABLE,
  TD,
  TH,
} from "../../shared/styles";
import { Callout, ErrorNote } from "../../shared/ui";
import type { ValueSetsApi } from "../../shared/useValueSets";
import type { SectionValues } from "./fields";
import { SchemaSection } from "./SchemaSection";

const BLANK: Omit<MedicationHistoryRow, "id" | "recorded_at" | "drug_code" | "source"> = {
  name: "",
  dose: "",
  frequency: "",
  route: "",
  status: "TAKING",
  reason: "",
  started_on: null,
};

const STATUS_LABELS: Record<MedicationHistoryRow["status"], string> = {
  TAKING: "Taking",
  STOPPED: "Stopped",
  INTERMITTENT: "Intermittent",
  UNKNOWN: "Unknown",
};

type MedicationReconciliation = {
  spec: IntakeSectionSpec;
  values: SectionValues;
  vs: ValueSetsApi;
  onChange: (key: string, value: unknown) => void;
};

/** Section 5 — one shared, structured medication list. Prescribed orders are a
 * separate MedicationRequest workflow. Confirm / update rather than re-enter. */
export function MedsSection({
  patientId,
  source = "Intake",
  reconciliation,
  onListChanged,
}: {
  patientId: string;
  source?: string;
  reconciliation?: MedicationReconciliation;
  onListChanged: () => void;
}) {
  const { accessToken } = useAuth();
  const [rows, setRows] = useState<MedicationHistoryRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [allergy, setAllergy] = useState<IntakeAllergy | null>(null);
  const [allergyError, setAllergyError] = useState<string | null>(null);
  const [draft, setDraft] = useState(BLANK);
  const [editingId, setEditingId] = useState<string | null>(null);

  useEffect(() => {
    if (!accessToken) return;
    let cancelled = false;
    listMedicationHistory(accessToken, patientId)
      .then((r) => !cancelled && setRows(r.results))
      .catch((e) => !cancelled && setError(errorText(e, "Couldn't load the medication list.")));
    getIntakeAllergy(accessToken, patientId)
      .then((data) => !cancelled && setAllergy(data))
      .catch(
        (e) =>
          !cancelled &&
          setAllergyError(errorText(e, "Couldn't load medication adverse-reaction records.")),
      );
    return () => {
      cancelled = true;
    };
  }, [accessToken, patientId]);

  function edit(row: MedicationHistoryRow) {
    setEditingId(row.id);
    setDraft({
      name: row.name,
      dose: row.dose,
      frequency: row.frequency,
      route: row.route,
      status: row.status,
      reason: row.reason,
      started_on: row.started_on,
    });
  }

  function cancelEdit() {
    setEditingId(null);
    setDraft(BLANK);
  }

  async function saveMedication() {
    if (!accessToken || !draft.name.trim()) return;
    setError(null);
    const payload = {
      ...draft,
      name: draft.name.trim(),
      source,
    };
    try {
      if (editingId) {
        const revised = await updateMedicationHistory(accessToken, editingId, payload);
        setRows((prev) => [...(prev ?? []).filter((row) => row.id !== editingId), revised]);
      } else {
        const created = await addMedicationHistory(accessToken, patientId, payload);
        setRows((prev) => [...(prev ?? []), created]);
      }
      cancelEdit();
      onListChanged();
    } catch (e) {
      setError(
        errorText(
          e,
          editingId ? "Couldn't update the medication." : "Couldn't add the medication.",
        ),
      );
    }
  }

  async function retire(id: string) {
    if (!accessToken) return;
    setError(null);
    try {
      await retireMedicationHistory(accessToken, id);
      setRows((prev) => (prev ?? []).filter((r) => r.id !== id));
      if (editingId === id) cancelEdit();
      onListChanged();
    } catch (e) {
      setError(errorText(e, "Couldn't retire the medication."));
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <Callout>
        One shared, structured medication history used by intake, the MAR and discharge. Prescribed
        orders are listed separately. <strong>Confirm / update rather than re-enter.</strong>
      </Callout>
      <ErrorNote>{error}</ErrorNote>
      <ErrorNote>{allergyError}</ErrorNote>
      <div className="overflow-x-auto">
        <table className={TABLE}>
          <thead>
            <tr>
              <th className={TH}>Medication</th>
              <th className={TH}>Dose</th>
              <th className={TH}>Route</th>
              <th className={TH}>Frequency</th>
              <th className={TH}>Indication</th>
              <th className={TH}>Adherence</th>
              <th className={TH}>Effect / side effects</th>
              <th className={TH}>
                <span className="sr-only">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {(rows ?? []).length === 0 && (
              <tr>
                <td className={TD} colSpan={8}>
                  {rows ? "No medications recorded yet." : "Loading…"}
                </td>
              </tr>
            )}
            {(rows ?? []).map((row) => (
              <tr key={row.id}>
                <td className={TD}>{row.name}</td>
                <td className={TD}>{row.dose}</td>
                <td className={TD}>{row.route}</td>
                <td className={TD}>{row.frequency}</td>
                <td className={TD}>{row.reason || "—"}</td>
                <td className={TD}>{STATUS_LABELS[row.status]}</td>
                <td className={TD}>
                  {allergy?.records
                    .filter(
                      (record) =>
                        record.clinical_status === "ACTIVE" &&
                        record.allergy_type === "ADR" &&
                        record.substance.trim().toLocaleLowerCase() ===
                          row.name.trim().toLocaleLowerCase(),
                    )
                    .map((record) =>
                      [
                        record.reaction || "Adverse reaction recorded",
                        record.verification_status === "UNCONFIRMED" ? "unconfirmed" : "",
                      ]
                        .filter(Boolean)
                        .join(" · ")
                        .concat(record.severity ? ` (${record.severity})` : ""),
                    )
                    .join("; ") || "—"}
                </td>
                <td className={TD}>
                  <button
                    type="button"
                    className={`${BTN_GHOST} ${BTN_SM}`}
                    aria-label={`Update ${row.name}`}
                    onClick={() => edit(row)}
                  >
                    Confirm / update
                  </button>
                  <button
                    type="button"
                    className={`${BTN_GHOST} ${BTN_SM}`}
                    onClick={() => void retire(row.id)}
                  >
                    Retire
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {allergy && (
        <p className="text-xs text-ink-500">
          Side effects shown here come from active shared adverse-reaction records for the same
          medication name. No matching record is not a confirmation that there are no side effects.
        </p>
      )}
      <div className="rounded-lg border border-surface-border p-3">
        <div className={FIELD_LABEL}>
          {editingId ? "Confirm / update medication" : "Add a medication to the shared history"}
        </div>
        <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-3">
          {(["name", "dose", "route", "frequency", "reason"] as const).map((key) => (
            <input
              key={key}
              className={INPUT}
              aria-label={
                key === "name" ? "Medication name" : key === "reason" ? "Indication" : key
              }
              placeholder={
                key === "name"
                  ? "Medication"
                  : key === "reason"
                    ? "Indication"
                    : key[0].toUpperCase() + key.slice(1)
              }
              // eslint-disable-next-line security/detect-object-injection -- fixed key union.
              value={draft[key]}
              onChange={(e) => setDraft((d) => ({ ...d, [key]: e.target.value }))}
            />
          ))}
          <label className="flex flex-col gap-1">
            <span className={FIELD_LABEL}>Adherence / status</span>
            <select
              className={INPUT}
              aria-label="Adherence / status"
              value={draft.status}
              onChange={(event) =>
                setDraft((current) => ({
                  ...current,
                  status: event.target.value as MedicationHistoryRow["status"],
                }))
              }
            >
              {Object.entries(STATUS_LABELS).map(([code, label]) => (
                <option key={code} value={code}>
                  {label}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="mt-2 flex gap-2">
          <button
            type="button"
            className={BTN}
            disabled={!draft.name.trim()}
            onClick={() => void saveMedication()}
          >
            {editingId ? "Save revised entry" : "Add to shared history"}
          </button>
          {editingId && (
            <button type="button" className={`${BTN_GHOST} ${BTN_SM}`} onClick={cancelEdit}>
              Cancel
            </button>
          )}
        </div>
      </div>
      {reconciliation && (
        <>
          <div className={GROUP_LABEL}>Reconciliation</div>
          <SchemaSection
            spec={reconciliation.spec}
            values={reconciliation.values}
            vs={reconciliation.vs}
            onChange={reconciliation.onChange}
          />
        </>
      )}
    </div>
  );
}
