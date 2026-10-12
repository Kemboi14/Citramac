import { useEffect, useState } from "react";
import { useAuth } from "../../../../auth/useAuth";
import {
  getIntakeAllergy,
  setIntakeAllergyStatus,
  verifyAllergy,
  type IntakeAllergy,
} from "../../../../lib/carePathwayApi";
import { createAllergyRecord } from "../../../../lib/clinicalApi";
import { errorText } from "../../triage/helpers";
import { BTN, BTN_GHOST, BTN_SM, INPUT, TABLE, TD, TH } from "../../shared/styles";
import { Callout, ErrorNote, SelectChoices, Tag } from "../../shared/ui";

const STATUSES = [
  { code: "UNKNOWN", display: "Unknown — not yet assessed" },
  { code: "NONE", display: "No known allergies" },
  { code: "ACTIVE_ALLERGIES", display: "Known allergy" },
];

/** Section 6 — the one allergy record (client-reported at registration stays
 * unconfirmed until a clinician confirms it; never re-asked). */
export function AllergySection({
  patientId,
  onChanged,
}: {
  patientId: string;
  onChanged: () => void;
}) {
  const { accessToken } = useAuth();
  const [data, setData] = useState<IntakeAllergy | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [substance, setSubstance] = useState("");
  const [reaction, setReaction] = useState("");

  useEffect(() => {
    if (!accessToken) return;
    let cancelled = false;
    getIntakeAllergy(accessToken, patientId)
      .then((d) => !cancelled && setData(d))
      .catch((e) => !cancelled && setError(errorText(e, "Couldn't load allergies.")));
    return () => {
      cancelled = true;
    };
  }, [accessToken, patientId]);

  async function run(action: () => Promise<IntakeAllergy>) {
    setError(null);
    try {
      setData(await action());
      onChanged();
    } catch (e) {
      setError(errorText(e, "Couldn't save the allergy change."));
    }
  }

  if (!data) return error ? <ErrorNote>{error}</ErrorNote> : <p className="text-[13px] text-ink-500">Loading…</p>;
  return (
    <div className="flex flex-col gap-3">
      <ErrorNote>{error}</ErrorNote>
      {data.records.some((r) => r.verification_status === "UNCONFIRMED") && (
        <Callout tone="warning">
          A client-reported allergy is still unconfirmed — confirm it before any prescribing.
        </Callout>
      )}
      <label className="flex max-w-sm flex-col gap-1 text-[11px] font-semibold uppercase text-ink-500">
        Allergy status
        <SelectChoices
          options={STATUSES}
          value={data.status}
          onChange={(code) =>
            void run(() => setIntakeAllergyStatus(accessToken!, patientId, code as IntakeAllergy["status"]))
          }
        />
      </label>
      <div className="overflow-x-auto">
        <table className={TABLE}>
          <thead>
            <tr>
              <th className={TH}>Substance</th>
              <th className={TH}>Reaction</th>
              <th className={TH}>Status</th>
              <th className={TH}>
                <span className="sr-only">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {data.records.length === 0 && (
              <tr>
                <td className={TD} colSpan={4}>
                  No allergies recorded.
                </td>
              </tr>
            )}
            {data.records.map((r) => (
              <tr key={r.id}>
                <td className={TD}>{r.substance}</td>
                <td className={TD}>{r.reaction}</td>
                <td className={TD}>
                  <Tag tone={r.verification_status === "CONFIRMED" ? "brand" : "warn"}>
                    {r.verification_status === "CONFIRMED" ? "Confirmed" : "Client-reported"}
                  </Tag>
                </td>
                <td className={TD}>
                  {r.verification_status === "UNCONFIRMED" && (
                    <span className="flex gap-1.5">
                      <button
                        type="button"
                        className={`${BTN} ${BTN_SM}`}
                        onClick={() => void run(() => verifyAllergy(accessToken!, r.id, "CONFIRMED"))}
                      >
                        Confirm
                      </button>
                      <button
                        type="button"
                        className={`${BTN_GHOST} ${BTN_SM}`}
                        onClick={() => void run(() => verifyAllergy(accessToken!, r.id, "REFUTED"))}
                      >
                        Not an allergy
                      </button>
                    </span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_1fr_auto]">
        <input className={INPUT} aria-label="Allergen" placeholder="Substance" value={substance} onChange={(e) => setSubstance(e.target.value)} />
        <input className={INPUT} aria-label="Reaction" placeholder="Reaction" value={reaction} onChange={(e) => setReaction(e.target.value)} />
        <button
          type="button"
          className={BTN}
          disabled={!substance.trim()}
          onClick={() =>
            void run(async () => {
              await createAllergyRecord(accessToken!, patientId, { substance: substance.trim(), reaction: reaction.trim() });
              setSubstance("");
              setReaction("");
              return setIntakeAllergyStatus(accessToken!, patientId, "ACTIVE_ALLERGIES");
            })
          }
        >
          Add allergy
        </button>
      </div>
    </div>
  );
}
