import { useEffect, useState } from "react";
import { useAuth } from "../../auth/AuthContext";
import { ApiError } from "../../lib/apiClient";
import { listPatients, type PatientListRow } from "../../lib/clinicalApi";
import {
  approveAsOrgAdmin,
  createErasureRequest,
  executeErasure,
  listErasureRequests,
  type ErasureRequest,
} from "../../lib/erasureApi";

const FIELD_CLASS =
  "rounded-sm border border-surface-border px-3 py-2 text-sm text-ink-900 outline-none focus:border-brand-green";
const LABEL_CLASS = "flex flex-col gap-1.5 text-sm font-medium text-ink-700";
const BUTTON_CLASS =
  "rounded-md bg-brand-green px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-brand-green-dark disabled:opacity-60";

const STATUS_TINT: Record<string, string> = {
  PENDING: "bg-ink-100 text-ink-700",
  RETENTION_CONFLICT: "bg-status-amber-tint text-status-amber",
  REJECTED: "bg-status-red-tint text-status-red",
  COMPLETED: "bg-brand-green-tint text-brand-green-dark",
};

/**
 * Right-to-Erasure request workflow — docs/09-SECURITY-COMPLIANCE.md §9.5.
 * Requires Org Admin *and* compliance-officer (Auditor role) sign-off
 * before execution; this screen covers the Org Admin's half of that —
 * the compliance-officer approval step is reachable via the same API from
 * wherever an Auditor-role user works, not duplicated here.
 */
export function ErasureRequestsPage() {
  const { accessToken } = useAuth();
  const [patients, setPatients] = useState<PatientListRow[]>([]);
  const [requests, setRequests] = useState<ErasureRequest[]>([]);
  const [selectedPatientId, setSelectedPatientId] = useState("");
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = async () => {
    if (!accessToken) return;
    const [patientRes, requestRes] = await Promise.all([
      listPatients(accessToken),
      listErasureRequests(accessToken),
    ]);
    setPatients(patientRes.results);
    setRequests(requestRes.results);
  };

  useEffect(() => {
    if (!accessToken) return;
    Promise.all([listPatients(accessToken), listErasureRequests(accessToken)])
      .then(([patientRes, requestRes]) => {
        setPatients(patientRes.results);
        setRequests(requestRes.results);
      })
      .catch(() => setError("Couldn't load erasure requests."));
  }, [accessToken]);

  const patientName = (id: string) => {
    const patient = patients.find((p) => p.id === id);
    return patient ? `${patient.first_name} ${patient.last_name}` : id;
  };

  const submitRequest = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!accessToken || !selectedPatientId) return;
    setError(null);
    setBusy(true);
    try {
      await createErasureRequest(accessToken, selectedPatientId, reason);
      setReason("");
      await refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't create the request.");
    } finally {
      setBusy(false);
    }
  };

  const approve = async (requestId: string) => {
    if (!accessToken) return;
    setError(null);
    setBusy(true);
    try {
      await approveAsOrgAdmin(accessToken, requestId);
      await refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't approve the request.");
    } finally {
      setBusy(false);
    }
  };

  const execute = async (requestId: string) => {
    if (!accessToken) return;
    setError(null);
    setBusy(true);
    try {
      await executeErasure(accessToken, requestId);
      await refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't execute the erasure.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-6">
      <div>
        <div className="mb-1.5 text-[11px] font-bold uppercase tracking-wide text-brand-green">
          Governance · Data Protection
        </div>
        <h1 className="font-display text-2xl font-bold text-ink-900">Right-to-Erasure Requests</h1>
      </div>

      <form
        onSubmit={submitRequest}
        className="rounded-lg border border-surface-border bg-surface-card p-6 shadow-sm"
      >
        <h2 className="mb-4 font-display text-base font-semibold text-ink-900">New Request</h2>
        <div className="flex items-end gap-3">
          <label className={LABEL_CLASS}>
            Client
            <select
              className={FIELD_CLASS}
              value={selectedPatientId}
              onChange={(e) => setSelectedPatientId(e.target.value)}
              required
            >
              <option value="">Select a client…</option>
              {patients.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.first_name} {p.last_name} ({p.citramac_number})
                </option>
              ))}
            </select>
          </label>
          <label className={`${LABEL_CLASS} flex-1`}>
            Reason
            <input
              className={FIELD_CLASS}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="e.g. Client formally requested erasure of their data."
            />
          </label>
          <button type="submit" disabled={busy} className={BUTTON_CLASS}>
            Submit Request
          </button>
        </div>
      </form>

      <div className="overflow-x-auto rounded-lg border border-surface-border bg-surface-card shadow-sm">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-surface-border bg-ink-50 text-xs font-semibold uppercase tracking-wide text-ink-500">
            <tr>
              <th className="px-4 py-3">Client</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3">Org Admin</th>
              <th className="px-4 py-3">Compliance Officer</th>
              <th className="px-4 py-3">Actions</th>
            </tr>
          </thead>
          <tbody>
            {requests.map((r) => (
              <tr key={r.id} className="border-b border-surface-border last:border-0">
                <td className="px-4 py-3 font-medium text-ink-900">{patientName(r.patient)}</td>
                <td className="px-4 py-3">
                  <span
                    className={`rounded-sm px-2 py-0.5 text-xs font-semibold ${
                      STATUS_TINT[r.status] ?? ""
                    }`}
                  >
                    {r.status}
                  </span>
                  {r.status === "RETENTION_CONFLICT" && (
                    <p className="mt-1 max-w-xs text-xs text-status-amber">
                      {r.retention_conflict_detail}
                    </p>
                  )}
                </td>
                <td className="px-4 py-3 text-ink-700">
                  {r.org_admin_approved_at ? "Approved" : "—"}
                </td>
                <td className="px-4 py-3 text-ink-700">
                  {r.compliance_officer_approved_at ? "Approved" : "—"}
                </td>
                <td className="px-4 py-3">
                  {!r.org_admin_approved_at && r.status === "PENDING" && (
                    <button
                      type="button"
                      disabled={busy}
                      className="text-sm font-semibold text-brand-green hover:underline"
                      onClick={() => approve(r.id)}
                    >
                      Approve
                    </button>
                  )}
                  {r.is_fully_approved && r.status !== "COMPLETED" && (
                    <button
                      type="button"
                      disabled={busy}
                      className="text-sm font-semibold text-brand-green hover:underline"
                      onClick={() => execute(r.id)}
                    >
                      Execute
                    </button>
                  )}
                </td>
              </tr>
            ))}
            {requests.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-6 text-center text-ink-500">
                  No erasure requests yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {error && (
        <p className="rounded-sm bg-status-red-tint px-3 py-2 text-sm text-status-red">{error}</p>
      )}
    </div>
  );
}
