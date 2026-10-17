import { useEffect, useState } from "react";
import { useAuth } from "../../../../auth/useAuth";
import {
  addIntakeAllergy,
  getIntakeAllergy,
  updateAllergyRecord,
  updateIntakeAllergy,
  verifyAllergy,
  type AllergyType,
  type IntakeAllergy,
  type IntakeAllergyRecord,
} from "../../../../lib/carePathwayApi";
import { formatDateTime } from "../../shared/format";
import { BTN, BTN_GHOST, BTN_SM, FIELD_LABEL, INPUT, TABLE, TD, TH } from "../../shared/styles";
import { Callout, ErrorNote, SelectChoices, Tag } from "../../shared/ui";
import type { ValueSetsApi } from "../../shared/useValueSets";
import { errorText } from "../../triage/helpers";

const STATUSES: { code: IntakeAllergy["status"]; label: string }[] = [
  { code: "UNKNOWN", label: "Allergy status unknown" },
  { code: "NONE", label: "No known allergies" },
  { code: "ACTIVE_ALLERGIES", label: "Known allergy / reaction" },
];
const CELL_INPUT = `${INPUT} min-w-[120px]`;

/** Section 6 — the one allergy record (INT-06, DATA-04). Carried forward from
 * Registration and confirmed or updated here, never re-asked. Removing a reaction
 * resolves or refutes it; nothing is deleted. */
export function AllergySection({
  patientId,
  vs,
  onChanged,
}: {
  patientId: string;
  vs: ValueSetsApi;
  onChanged: () => void;
}) {
  const { accessToken } = useAuth();
  const [data, setData] = useState<IntakeAllergy | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState({ substance: "", allergy_type: "ALLERGY" as AllergyType, reaction: "", severity: "UNKNOWN" });
  const [removing, setRemoving] = useState<string | null>(null);

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

  async function run(action: (token: string) => Promise<IntakeAllergy>) {
    if (!accessToken) return;
    setError(null);
    try {
      setData(await action(accessToken));
      onChanged();
    } catch (e) {
      setError(errorText(e, "Couldn't save the allergy change."));
    }
  }

  if (!data) return error ? <ErrorNote>{error}</ErrorNote> : <p className="text-[13px] text-ink-500">Loading…</p>;

  const edit = (record: IntakeAllergyRecord, body: Parameters<typeof updateAllergyRecord>[2]) =>
    void run((token) => updateAllergyRecord(token, record.id, body));
  const active = data.records.filter((r) => r.clinical_status === "ACTIVE");
  const summary =
    data.status === "NONE"
      ? "No known allergies"
      : data.status === "UNKNOWN"
        ? "Allergy status unknown"
        : active.map((r) => `${r.substance} (${vs.label("allergy-type", r.allergy_type)})`).join(", ") || "Known allergy";

  return (
    <div className="flex flex-col gap-3">
      <ErrorNote>{error}</ErrorNote>
      <div className="flex flex-wrap items-center gap-2 text-[13px]">
        <Tag tone="brand">Existing allergy record: {summary}</Tag>
        {data.info_source && <span className="text-[11px] text-ink-500">source: {vs.label("allergy-info-source", data.info_source)}</span>}
        {data.confirmed_at && (
          <Tag>
            Confirmed {formatDateTime(data.confirmed_at)}
            {data.confirmed_by ? ` · ${data.confirmed_by}` : ""}
          </Tag>
        )}
      </div>
      {data.status === "UNKNOWN" ? (
        <Callout tone="warning">
          Allergy status is <strong>unknown</strong>. Ask now — prescribing stays locked until the status is recorded.
        </Callout>
      ) : (
        <div>
          <button type="button" className={`${BTN} ${BTN_SM}`} onClick={() => void run((t) => updateIntakeAllergy(t, patientId, { confirm: true }))}>
            Confirm — unchanged
          </button>
        </div>
      )}
      {data.records.some((r) => r.verification_status === "UNCONFIRMED") && (
        <Callout tone="warning">
          A client-reported allergy is still unconfirmed — confirm it before any prescribing.
        </Callout>
      )}

      <h3 className="text-[13px] font-bold text-ink-900">
        Confirm / update
      </h3>
      <div role="group" aria-label="Allergy status" className="grid grid-cols-1 gap-2 sm:grid-cols-3">
        {STATUSES.map((s) => (
          <button
            key={s.code}
            type="button"
            aria-pressed={data.status === s.code}
            className={`rounded-lg border px-3 py-2 text-[13px] font-semibold ${
              data.status === s.code ? "border-brand-green bg-brand-green-tint text-brand-green-dark" : "border-surface-border text-ink-900"
            }`}
            onClick={() => data.status !== s.code && void run((t) => updateIntakeAllergy(t, patientId, { status: s.code }))}
          >
            {s.label}
          </button>
        ))}
      </div>
      <label className="flex max-w-sm flex-col gap-1">
        <span className={FIELD_LABEL}>Source of allergy information</span>
        <SelectChoices
          options={vs.options("allergy-info-source")}
          placeholder="— select —"
          value={data.info_source}
          onChange={(code) => void run((t) => updateIntakeAllergy(t, patientId, { info_source: code }))}
        />
      </label>

      {(data.status === "ACTIVE_ALLERGIES" || data.records.length > 0) && (
        <>
          <div className="max-w-full overflow-x-auto">
            <table className={`${TABLE} min-w-[720px]`}>
              <thead>
                <tr>
                  <th className={TH}>Substance / medicine or class</th>
                  <th className={TH}>Type</th>
                  <th className={TH}>Reaction</th>
                  <th className={TH}>Severity</th>
                  <th className={TH}>Status</th>
                  <th className={TH}>
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {data.records.length === 0 && (
                  <tr>
                    <td className={TD} colSpan={6}>
                      No reactions recorded yet — add one below.
                    </td>
                  </tr>
                )}
                {data.records.map((r) => (
                  <tr key={r.id} className={r.clinical_status === "RESOLVED" ? "opacity-60" : ""}>
                    <td className={TD}>
                      <input
                        className={CELL_INPUT}
                        aria-label="Substance"
                        defaultValue={r.substance}
                        onBlur={(e) => e.target.value.trim() && e.target.value.trim() !== r.substance && edit(r, { substance: e.target.value.trim() })}
                      />
                    </td>
                    <td className={TD}>
                      <select
                        className={CELL_INPUT}
                        aria-label={`Type of ${r.substance}`}
                        value={r.allergy_type}
                        onChange={(e) => edit(r, { allergy_type: e.target.value as AllergyType })}
                      >
                        {vs.options("allergy-type").map((o) => (
                          <option key={o.code} value={o.code}>
                            {o.display}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className={TD}>
                      <input
                        className={CELL_INPUT}
                        aria-label={`Reaction to ${r.substance}`}
                        defaultValue={r.reaction}
                        onBlur={(e) => e.target.value.trim() !== r.reaction && edit(r, { reaction: e.target.value.trim() })}
                      />
                    </td>
                    <td className={TD}>
                      <select
                        className={CELL_INPUT}
                        aria-label={`Severity of reaction to ${r.substance}`}
                        value={r.severity}
                        onChange={(e) => edit(r, { severity: e.target.value })}
                      >
                        <option value="">— select —</option>
                        {r.severity && !vs.options("allergy-severity").some((o) => o.code === r.severity) && (
                          <option value={r.severity}>{r.severity} (as recorded)</option>
                        )}
                        {vs.options("allergy-severity").map((o) => (
                          <option key={o.code} value={o.code}>
                            {o.display}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className={TD}>
                      <div className="flex flex-col items-start gap-1">
                        <Tag tone={r.clinical_status === "RESOLVED" ? "neutral" : "risk"}>
                          {r.clinical_status === "RESOLVED" ? "Resolved" : "Active"}
                        </Tag>
                        <Tag tone={r.verification_status === "CONFIRMED" ? "brand" : "warn"}>
                          {r.verification_status === "CONFIRMED" ? "Confirmed" : "Client-reported"}
                        </Tag>
                      </div>
                    </td>
                    <td className={TD}>
                      <div className="flex flex-wrap gap-1.5">
                        {r.verification_status === "UNCONFIRMED" && (
                          <button type="button" className={`${BTN} ${BTN_SM}`} onClick={() => void run((t) => verifyAllergy(t, r.id, "CONFIRMED"))}>
                            Confirm
                          </button>
                        )}
                        {r.clinical_status === "RESOLVED" ? (
                          <button type="button" className={`${BTN_GHOST} ${BTN_SM}`} onClick={() => edit(r, { status: "ACTIVE" })}>
                            Re-activate
                          </button>
                        ) : removing === r.id ? (
                          <>
                            <button type="button" className={`${BTN_GHOST} ${BTN_SM}`} onClick={() => { setRemoving(null); edit(r, { status: "RESOLVED" }); }}>
                              Resolved — no longer applies
                            </button>
                            <button type="button" className={`${BTN_GHOST} ${BTN_SM}`} onClick={() => { setRemoving(null); edit(r, { status: "REFUTED" }); }}>
                              Refuted — not this reaction
                            </button>
                            <button type="button" className={`${BTN_GHOST} ${BTN_SM}`} onClick={() => setRemoving(null)}>
                              Cancel
                            </button>
                          </>
                        ) : (
                          <button type="button" className={`${BTN_GHOST} ${BTN_SM}`} onClick={() => setRemoving(r.id)}>
                            Remove
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-[1.4fr_1fr_1fr_1fr_auto]">
            <input className={INPUT} aria-label="New substance" placeholder="Substance, e.g. Penicillin" value={draft.substance} onChange={(e) => setDraft((d) => ({ ...d, substance: e.target.value }))} />
            <select className={INPUT} aria-label="New reaction type" value={draft.allergy_type} onChange={(e) => setDraft((d) => ({ ...d, allergy_type: e.target.value as AllergyType }))}>
              {vs.options("allergy-type").map((o) => (
                <option key={o.code} value={o.code}>
                  {o.display}
                </option>
              ))}
            </select>
            <input className={INPUT} aria-label="New reaction" placeholder="Reaction, e.g. rash" value={draft.reaction} onChange={(e) => setDraft((d) => ({ ...d, reaction: e.target.value }))} />
            <select className={INPUT} aria-label="New reaction severity" value={draft.severity} onChange={(e) => setDraft((d) => ({ ...d, severity: e.target.value }))}>
              {vs.options("allergy-severity").map((o) => (
                <option key={o.code} value={o.code}>
                  {o.display}
                </option>
              ))}
            </select>
            <button
              type="button"
              className={BTN}
              disabled={!draft.substance.trim()}
              onClick={() =>
                void run(async (token) => {
                  const next = await addIntakeAllergy(token, patientId, { ...draft, substance: draft.substance.trim(), reaction: draft.reaction.trim() });
                  setDraft({ substance: "", allergy_type: "ALLERGY", reaction: "", severity: "UNKNOWN" });
                  return next;
                })
              }
            >
              Add
            </button>
          </div>
          <Callout>
            <strong>Allergy</strong> (immune reaction) hard-stops prescribing. <strong>Intolerance</strong> and{" "}
            <strong>ADR</strong> (e.g. dystonia on haloperidol) warn but do not block.
          </Callout>
        </>
      )}
    </div>
  );
}
