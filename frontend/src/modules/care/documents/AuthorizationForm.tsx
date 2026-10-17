import { useState } from "react";
import { useAuth } from "../../../auth/useAuth";
import { ApiError } from "../../../lib/apiClient";
import { recordReleaseAuthorization, type BlockInfo } from "../../../lib/documentsApi";
import { BTN, INPUT } from "../shared/styles";
import { CheckChoices, ErrorNote, Field } from "../shared/ui";
import { useDocCatalogue } from "./useDocCatalogue";

const CONSENT_LABEL: Record<string, string> = {
  EMPLOYER_COMMUNICATION: "Communicating with the client's employer",
  SCHOOL_COMMUNICATION: "Communicating with the client's school / university",
  RELEASE_OF_INFORMATION: "Releasing information to a named third party",
  FAMILY_INVOLVEMENT: "Involving family / caregiver",
};

/** DOC-CI-06 prompt: record the client's authorization (obtained on the
 * facility's own form) into the one consent store, then re-check. */
export function AuthorizationForm({
  patientId,
  block,
  recipient,
  purpose,
  offeredClasses,
  onRecorded,
}: {
  patientId: string;
  block: BlockInfo;
  recipient: string;
  purpose: string;
  offeredClasses: string[];
  onRecorded: () => void;
}) {
  const { accessToken } = useAuth();
  const { className } = useDocCatalogue();
  const [form, setForm] = useState({
    decision: "YES" as "YES" | "NO",
    recipient,
    purpose,
    disclosure_scope: block.missing_classes ?? [],
    valid_until: "",
    evidence: "",
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = () => {
    if (!accessToken) return;
    setBusy(true);
    setError(null);
    recordReleaseAuthorization(accessToken, {
      patient_id: patientId,
      consent_type: block.consent_type,
      ...form,
    })
      .then(() => onRecorded())
      .catch((err) => setError(err instanceof ApiError ? err.message : "Couldn't record it."))
      .finally(() => setBusy(false));
  };

  return (
    <div className="mt-3 rounded-lg border border-surface-border bg-surface-card p-4">
      <h3 className="mb-1 text-[13px] font-bold text-ink-900">
        Record the client&rsquo;s authorization
      </h3>
      <p className="mb-3 text-[12.5px] text-ink-500">
        {CONSENT_LABEL[block.consent_type] ?? block.consent_type}. Record it only once the client
        has actually given (or refused) it — for example on the facility&rsquo;s signed form.
      </p>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <Field label="Client's decision" htmlFor="auth-decision">
          <select
            id="auth-decision"
            className={INPUT}
            value={form.decision}
            onChange={(e) => {
              const value = e.target.value as "YES" | "NO";
              setForm((prev) => ({ ...prev, decision: value }));
            }}
          >
            <option value="YES">Authorized</option>
            <option value="NO">Refused</option>
          </select>
        </Field>
        <Field label="Recipient (blank = any recipient of this type)" htmlFor="auth-recipient">
          <input
            id="auth-recipient"
            className={INPUT}
            value={form.recipient}
            onChange={(e) => {
              const value = e.target.value;
              setForm((prev) => ({ ...prev, recipient: value }));
            }}
          />
        </Field>
        <Field label="Purpose" htmlFor="auth-purpose">
          <input
            id="auth-purpose"
            className={INPUT}
            value={form.purpose}
            onChange={(e) => {
              const value = e.target.value;
              setForm((prev) => ({ ...prev, purpose: value }));
            }}
          />
        </Field>
        <Field label="Valid until" htmlFor="auth-valid">
          <input
            id="auth-valid"
            type="date"
            className={INPUT}
            value={form.valid_until}
            onChange={(e) => {
              const value = e.target.value;
              setForm((prev) => ({ ...prev, valid_until: value }));
            }}
          />
        </Field>
        {offeredClasses.length > 0 && (
          <Field
            label="Information the client authorizes (beyond the default)"
            className="md:col-span-2"
          >
            <CheckChoices
              columns={2}
              options={offeredClasses.map((c) => ({ code: c, display: className(c) }))}
              value={form.disclosure_scope}
              onChange={(codes) => setForm((prev) => ({ ...prev, disclosure_scope: codes }))}
            />
          </Field>
        )}
        <Field
          label="How it was obtained *"
          htmlFor="auth-evidence"
          className="md:col-span-2"
          hint="e.g. signed authorization form reference and date"
        >
          <input
            id="auth-evidence"
            className={INPUT}
            value={form.evidence}
            onChange={(e) => {
              const value = e.target.value;
              setForm((prev) => ({ ...prev, evidence: value }));
            }}
          />
        </Field>
      </div>
      <div className="mt-3 flex items-center gap-3">
        <button
          type="button"
          className={BTN}
          disabled={busy || !form.evidence.trim()}
          onClick={submit}
        >
          {busy ? "Recording…" : "Record authorization"}
        </button>
      </div>
      {error && (
        <div className="mt-2">
          <ErrorNote>{error}</ErrorNote>
        </div>
      )}
    </div>
  );
}
