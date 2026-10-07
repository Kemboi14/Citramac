import { AuthenticatedDownloadButton } from "../../components/AuthenticatedDownloadButton";
import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import { CheckCircle2, Pencil, RefreshCw, X } from "lucide-react";
import { useAuth } from "../../auth/useAuth";
import { ApiError } from "../../lib/apiClient";
import { SaveButton } from "../../components/SaveButton";
import {
  listTenantCompliance,
  updateTenantCompliance,
  type ComplianceProfile,
} from "../../lib/complianceApi";

const FIELD_CLASS =
  "rounded-sm border border-surface-border bg-surface-card px-3 py-2 text-sm text-ink-900 outline-none transition-colors duration-150 focus:border-brand-green";
const LABEL_CLASS = "flex flex-col gap-1.5 text-sm font-medium text-ink-700";
const BUTTON_GHOST =
  "inline-flex items-center gap-1.5 rounded-md border border-surface-border bg-surface-card px-3 py-1.5 text-sm font-medium text-ink-700 hover:bg-surface-bg transition-colors duration-150";

const COLUMN_COUNT = 7;

function formatDate(value: string | null) {
  if (!value) return "—";
  // A bare date (YYYY-MM-DD) is parsed as local midnight, not UTC, so it
  // never displays as the previous day.
  const date = /^\d{4}-\d{2}-\d{2}$/.test(value) ? new Date(`${value}T00:00:00`) : new Date(value);
  return date.toLocaleDateString(undefined, { dateStyle: "medium" });
}

/** Date-only ISO (YYYY-MM-DD) for a `date` input; the API returns dates as such. */
function toDateInput(value: string | null) {
  return value ? value.slice(0, 10) : "";
}

function errorMessage(err: unknown, fallback: string) {
  return err instanceof ApiError ? err.message : fallback;
}

export function TenantCompliancePage() {
  const { accessToken } = useAuth();
  const [rows, setRows] = useState<ComplianceProfile[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [onlyGaps, setOnlyGaps] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  const load = useCallback(() => {
    if (!accessToken) return;
    listTenantCompliance(accessToken)
      .then((data) => {
        setRows(data.results);
        setError(null);
      })
      .catch((err) => setError(errorMessage(err, "Couldn't load facility compliance.")));
  }, [accessToken]);

  useEffect(() => {
    load();
  }, [load]);

  const visible = useMemo(
    () => (rows ?? []).filter((row) => !onlyGaps || row.gaps.length > 0),
    [rows, onlyGaps],
  );
  const gapCount = (rows ?? []).filter((row) => row.gaps.length > 0).length;

  const onSaved = (updated: ComplianceProfile) => {
    setRows(
      (prev) =>
        prev?.map((row) => (row.organization_id === updated.organization_id ? updated : row)) ??
        null,
    );
    setEditingId(null);
  };

  return (
    <div className="flex flex-col gap-6 animate-fade-in">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="mb-1.5 text-[11px] font-bold uppercase tracking-wide text-brand-green">
            Governance · Data protection
          </div>
          <h1 className="font-display text-2xl font-bold text-ink-900">Tenant Compliance</h1>
          <p className="mt-1 max-w-3xl text-sm text-ink-500">
            For each facility: ODPC registration evidence, the signed data processing agreement and
            acceptance of the current compliance warranty. Verify ODPC registrations against the
            evidence the facility uploaded.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <label className="flex items-center gap-2 text-sm text-ink-700">
            <input
              type="checkbox"
              className="h-[15px] w-[15px] accent-brand-green"
              checked={onlyGaps}
              onChange={(e) => setOnlyGaps(e.target.checked)}
            />
            Only facilities with gaps
            {rows && (
              <span className="rounded-sm bg-status-amber-tint px-1.5 py-0.5 text-xs font-semibold text-status-amber">
                {gapCount}
              </span>
            )}
          </label>
          <button type="button" className={BUTTON_GHOST} onClick={load}>
            <RefreshCw className="h-3.5 w-3.5" />
            Refresh
          </button>
        </div>
      </div>

      {error && (
        <p className="rounded-sm bg-status-red-tint px-3 py-2 text-sm text-status-red">{error}</p>
      )}

      <div className="overflow-x-auto rounded-lg border border-surface-border bg-surface-card shadow-sm">
        <table className="w-full min-w-[1080px] text-left text-sm">
          <thead className="border-b border-surface-border bg-surface-bg text-xs uppercase tracking-wide text-ink-500">
            <tr>
              <th className="px-4 py-3 font-semibold">Facility</th>
              <th className="px-4 py-3 font-semibold">Compliance</th>
              <th className="px-4 py-3 font-semibold">ODPC registration</th>
              <th className="px-4 py-3 font-semibold">Data processing agreement</th>
              <th className="px-4 py-3 font-semibold">Warranty</th>
              <th className="px-4 py-3 font-semibold">DPO contact</th>
              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody>
            {rows === null && !error && (
              <tr>
                <td colSpan={COLUMN_COUNT} className="px-4 py-6 text-center text-ink-500">
                  Loading facilities…
                </td>
              </tr>
            )}
            {rows && visible.length === 0 && (
              <tr>
                <td colSpan={COLUMN_COUNT} className="px-4 py-6 text-center text-ink-500">
                  {onlyGaps ? "Every facility is complete." : "No facilities yet."}
                </td>
              </tr>
            )}
            {visible.map((row) => (
              <Fragment key={row.organization_id}>
                <tr className="border-b border-surface-border align-top last:border-0">
                  <td className="px-4 py-3 font-medium text-ink-900">{row.organization_name}</td>
                  <td className="px-4 py-3">
                    {row.gaps.length === 0 ? (
                      <span className="inline-flex items-center gap-1 rounded-sm bg-brand-green-tint px-2 py-0.5 text-xs font-semibold text-brand-green-dark">
                        <CheckCircle2 className="h-3 w-3" />
                        Complete
                      </span>
                    ) : (
                      <div className="flex max-w-[260px] flex-wrap gap-1">
                        {row.gaps.map((gap) => (
                          <span
                            key={gap}
                            className="rounded-sm bg-status-amber-tint px-2 py-0.5 text-xs font-semibold text-status-amber"
                          >
                            {gap}
                          </span>
                        ))}
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-3 text-ink-700">
                    <div className="font-mono text-xs">{row.odpc_registration_number || "—"}</div>
                    <div className="text-xs text-ink-500">
                      Expires {formatDate(row.odpc_registration_expires_on)}
                    </div>
                    <div className="text-xs">
                      {row.odpc_verified_at ? (
                        <span className="text-brand-green-dark">
                          Verified {formatDate(row.odpc_verified_at)}
                          {row.odpc_verified_by ? ` by ${row.odpc_verified_by}` : ""}
                        </span>
                      ) : (
                        <span className="text-status-amber">Not verified</span>
                      )}
                    </div>
                    {row.odpc_evidence_url && (
                      <AuthenticatedDownloadButton
                        path={row.odpc_evidence_url}
                        filename={`odpc-evidence-${row.organization_name}`}
                      >
                        Evidence
                      </AuthenticatedDownloadButton>
                    )}
                  </td>
                  <td className="px-4 py-3 text-ink-700">
                    <div>{row.dpa_version || "—"}</div>
                    <div className="text-xs text-ink-500">
                      {row.dpa_signed_on ? `Signed ${formatDate(row.dpa_signed_on)}` : "Not signed"}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-ink-700">
                    {row.warranty_version ? (
                      <>
                        <div>
                          {row.warranty_version}
                          {row.current_warranty_version &&
                            row.warranty_version !== row.current_warranty_version && (
                              <span className="ml-1 text-xs text-status-amber">
                                (current: {row.current_warranty_version})
                              </span>
                            )}
                        </div>
                        <div className="text-xs text-ink-500">
                          Accepted {formatDate(row.warranty_accepted_at)}
                          {row.warranty_accepted_by ? ` by ${row.warranty_accepted_by}` : ""}
                        </div>
                      </>
                    ) : (
                      <span className="text-ink-500">Not accepted</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-ink-700">
                    {row.dpo_name || row.dpo_email || row.dpo_phone ? (
                      <>
                        {row.dpo_name && <div>{row.dpo_name}</div>}
                        {row.dpo_email && (
                          <div className="text-xs text-ink-500">{row.dpo_email}</div>
                        )}
                        {row.dpo_phone && (
                          <div className="text-xs text-ink-500">{row.dpo_phone}</div>
                        )}
                      </>
                    ) : (
                      <span className="text-ink-500">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right">
                    {editingId !== row.organization_id && (
                      <button
                        type="button"
                        className={BUTTON_GHOST}
                        onClick={() => setEditingId(row.organization_id)}
                      >
                        <Pencil className="h-3.5 w-3.5" />
                        Edit
                      </button>
                    )}
                  </td>
                </tr>
                {editingId === row.organization_id && accessToken && (
                  <tr className="border-b border-surface-border bg-surface-bg last:border-0">
                    <td colSpan={COLUMN_COUNT} className="px-4 py-4">
                      <RowEditor
                        accessToken={accessToken}
                        row={row}
                        onCancel={() => setEditingId(null)}
                        onSaved={onSaved}
                      />
                    </td>
                  </tr>
                )}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function RowEditor({
  accessToken,
  row,
  onCancel,
  onSaved,
}: {
  accessToken: string;
  row: ComplianceProfile;
  onCancel: () => void;
  onSaved: (updated: ComplianceProfile) => void;
}) {
  const [number, setNumber] = useState(row.odpc_registration_number);
  const [expires, setExpires] = useState(toDateInput(row.odpc_registration_expires_on));
  const [verify, setVerify] = useState(false);
  const [dpaVersion, setDpaVersion] = useState(row.dpa_version);
  const [dpaSigned, setDpaSigned] = useState(toDateInput(row.dpa_signed_on));
  const [error, setError] = useState<string | null>(null);

  const hasNumber = number.trim().length > 0;

  const submit = async () => {
    setError(null);
    try {
      const updated = await updateTenantCompliance(accessToken, row.organization_id, {
        odpc_registration_number: number.trim(),
        odpc_registration_expires_on: expires || null,
        dpa_version: dpaVersion.trim(),
        dpa_signed_on: dpaSigned || null,
        ...(verify && hasNumber ? { verify_odpc: true } : {}),
      });
      onSaved(updated);
    } catch (err) {
      setError(errorMessage(err, "Couldn't save the facility's compliance record."));
      throw err;
    }
  };

  return (
    <form onSubmit={(e) => e.preventDefault()} className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <div className="text-sm font-semibold text-ink-900">{row.organization_name}</div>
        <button
          type="button"
          onClick={onCancel}
          aria-label="Close editor"
          className="rounded p-1 text-ink-500 hover:text-ink-900"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4">
        <label className={LABEL_CLASS}>
          ODPC registration number
          <input
            className={FIELD_CLASS}
            value={number}
            onChange={(e) => {
              setNumber(e.target.value);
              if (!e.target.value.trim()) setVerify(false);
            }}
          />
        </label>
        <label className={LABEL_CLASS}>
          ODPC registration expires
          <input
            type="date"
            className={FIELD_CLASS}
            value={expires}
            onChange={(e) => setExpires(e.target.value)}
          />
        </label>
        <label className={LABEL_CLASS}>
          DPA version
          <input
            className={FIELD_CLASS}
            value={dpaVersion}
            onChange={(e) => setDpaVersion(e.target.value)}
          />
        </label>
        <label className={LABEL_CLASS}>
          DPA signed on
          <input
            type="date"
            className={FIELD_CLASS}
            value={dpaSigned}
            onChange={(e) => setDpaSigned(e.target.value)}
          />
        </label>
      </div>

      <div className="rounded-md border border-surface-border bg-surface-card px-4 py-3 text-sm">
        {row.odpc_verified_at && (
          <p className="mb-2 text-brand-green-dark">
            Verified {formatDate(row.odpc_verified_at)}
            {row.odpc_verified_by ? ` by ${row.odpc_verified_by}` : ""}.
          </p>
        )}
        {row.odpc_evidence_url ? (
          <p className="mb-2 text-ink-700">
            Check the facility&rsquo;s uploaded evidence first:{" "}
            <AuthenticatedDownloadButton
              path={row.odpc_evidence_url}
              filename={`odpc-evidence-${row.organization_name}`}
            >
              Download ODPC evidence
            </AuthenticatedDownloadButton>
          </p>
        ) : (
          <p className="mb-2 text-status-amber">The facility has not uploaded ODPC evidence.</p>
        )}
        {hasNumber ? (
          <label className="flex items-center gap-2 font-medium text-ink-700">
            <input
              type="checkbox"
              className="h-[15px] w-[15px] accent-brand-green"
              checked={verify}
              onChange={(e) => setVerify(e.target.checked)}
            />
            {row.odpc_verified_at
              ? "Mark ODPC registration verified again (records you and now)"
              : "Mark ODPC registration verified"}
          </label>
        ) : (
          <p className="text-ink-500">
            Enter the registration number before marking the registration verified.
          </p>
        )}
      </div>

      {error && (
        <p className="rounded-sm bg-status-red-tint px-3 py-2 text-sm text-status-red">{error}</p>
      )}
      <div className="flex items-center gap-3">
        <SaveButton onSave={submit}>Save</SaveButton>
        <button type="button" className={BUTTON_GHOST} onClick={onCancel}>
          Cancel
        </button>
      </div>
    </form>
  );
}
