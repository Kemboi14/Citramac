import { useEffect, useState } from "react";
import { ApiError } from "../../../lib/apiClient";
import {
  fetchShaRemittance,
  listShaRemittances,
  type ShaRemittanceStatement,
} from "../../../lib/claimsApi";
import { getMyProfile, type MyProfile } from "../../../lib/myProfileApi";
import { RawJson } from "../record/billing/parts";
import { formatDateTime } from "../shared/format";
import { BTN_GHOST, BTN_SM, INPUT } from "../shared/styles";
import { Callout, Card, ErrorNote, Field, Tag } from "../shared/ui";

// Billing → SHA remittances fetched from the DHA HIE (apps.insurance_claims
// sha_remittance). DHA has not published the remittance shape, so each
// statement is kept and shown exactly as received and is not matched to
// claims here — finance posts each remittance against its claim with the
// client's Billing stage payment form.

export function ShaRemittances({ accessToken }: { accessToken: string }) {
  const [statements, setStatements] = useState<ShaRemittanceStatement[] | null>(null);
  const [branches, setBranches] = useState<MyProfile["branches"]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({ branch: "", bankReference: "" });

  useEffect(() => {
    let cancelled = false;
    listShaRemittances(accessToken)
      .then((data) => !cancelled && setStatements(data.statements))
      .catch(
        (err) =>
          !cancelled &&
          setLoadError(
            err instanceof ApiError
              ? err.message
              : "SHA remittance statements could not be loaded.",
          ),
      );
    getMyProfile(accessToken)
      .then((profile) => {
        if (cancelled) return;
        setBranches(profile.branches);
        if (profile.branches.length === 1)
          setForm((f) => ({ ...f, branch: profile.branches[0].id }));
      })
      .catch(
        (err) =>
          !cancelled &&
          setError(err instanceof ApiError ? err.message : "Your branches could not be loaded."),
      );
    return () => {
      cancelled = true;
    };
  }, [accessToken]);

  return (
    <Card title="SHA remittances" className="mt-[18px]">
      <div className="grid gap-3">
        <Callout>
          Remittance statements fetched from SHA through the DHA HIE, shown exactly as SHA sent
          them. DHA has not published their layout, so they are not matched to claims automatically:
          post each remittance against its claim with the payment form in the client’s Billing stage
          (method “Insurer remittance”, with the remittance number as reference).
        </Callout>
        <form
          className="flex flex-wrap items-end gap-2"
          onSubmit={async (e) => {
            e.preventDefault();
            if (busy) return;
            setBusy(true);
            setError(null);
            try {
              const statement = await fetchShaRemittance(accessToken, {
                branch: form.branch,
                bank_reference: form.bankReference.trim() || undefined,
              });
              setStatements((list) => [statement, ...(list ?? [])]);
              setForm((f) => ({ ...f, bankReference: "" }));
            } catch (err) {
              setError(
                err instanceof ApiError ? err.message : "The remittance could not be fetched.",
              );
            } finally {
              setBusy(false);
            }
          }}
        >
          <Field label="Branch" htmlFor="remit-branch" className="w-64">
            <select
              id="remit-branch"
              className={INPUT}
              required
              value={form.branch}
              onChange={(e) => setForm((f) => ({ ...f, branch: e.target.value }))}
            >
              <option value="">Choose the branch…</option>
              {branches.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </select>
          </Field>
          <Field
            label="Bank reference (optional)"
            htmlFor="remit-ref"
            className="w-64"
            hint="With a reference: the claims SHA paid under it. Without: SHA’s remittance list."
          >
            <input
              id="remit-ref"
              className={INPUT}
              value={form.bankReference}
              onChange={(e) => setForm((f) => ({ ...f, bankReference: e.target.value }))}
            />
          </Field>
          <button
            type="submit"
            className={`${BTN_GHOST} ${BTN_SM} mb-[22px]`}
            disabled={busy || !form.branch}
          >
            {busy ? "Fetching…" : "Fetch from SHA"}
          </button>
        </form>
        <ErrorNote>{error}</ErrorNote>
        <ErrorNote>{loadError}</ErrorNote>
        {statements && statements.length === 0 && (
          <p className="text-[13px] text-ink-500">No remittance statement fetched yet.</p>
        )}
        {statements && statements.length > 0 && (
          <ul className="grid gap-2">
            {statements.map((s) => (
              <li key={s.id} className="rounded-lg border border-surface-border">
                <details>
                  <summary className="flex cursor-pointer flex-wrap items-center gap-2 px-3 py-2 text-[13px]">
                    <span className="font-semibold">{s.kind_label}</span>
                    {s.bank_reference && <Tag>{s.bank_reference}</Tag>}
                    <span className="text-ink-500">fetched {formatDateTime(s.fetched_at)}</span>
                  </summary>
                  <div className="border-t border-surface-border p-3">
                    <RawJson value={s.body} label={`${s.kind_label} as received from SHA`} />
                  </div>
                </details>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Card>
  );
}
