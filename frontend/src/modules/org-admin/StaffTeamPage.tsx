import { useEffect, useState } from "react";
import { UserPlus, Users } from "lucide-react";
import { useAuth } from "../../auth/useAuth";
import { ApiError } from "../../lib/apiClient";
import { listBranches, type Branch } from "../../lib/branchesApi";
import {
  deactivateStaff,
  inviteStaff,
  listRoles,
  listStaff,
  toggleStaffDuty,
  type Role,
  type Staff,
} from "../../lib/governanceApi";

const FIELD_CLASS =
  "rounded-sm border border-surface-border px-3 py-2 text-sm text-ink-900 outline-none transition-colors duration-150 focus:border-brand-green";
const LABEL_CLASS = "flex flex-col gap-1.5 text-sm font-medium text-ink-700";
const BUTTON_CLASS =
  "rounded-md bg-brand-green px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-brand-green-dark active:scale-[0.98] disabled:opacity-60 disabled:active:scale-100 transition-all duration-150";
const CARD_CLASS = "rounded-lg border border-surface-border bg-surface-card p-6 shadow-sm";

const EMPTY_INVITE = {
  email: "",
  first_name: "",
  last_name: "",
  staff_id: "",
  role: "",
  primary_branch: "",
};

/**
 * Org Admin's staff roster — doctors, nurses, therapists, supervisors.
 * citramac_ORG-admin.html "Staff / CCP Team".
 */
export function StaffTeamPage() {
  const { accessToken } = useAuth();
  const [staff, setStaff] = useState<Staff[]>([]);
  const [roles, setRoles] = useState<Role[]>([]);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [roleFilter, setRoleFilter] = useState("");
  const [showInviteForm, setShowInviteForm] = useState(false);
  const [inviteForm, setInviteForm] = useState(EMPTY_INVITE);
  const [inviteError, setInviteError] = useState<string | null>(null);

  const refreshStaff = async () => {
    if (!accessToken) return;
    const res = await listStaff(accessToken);
    setStaff(res.results);
  };

  useEffect(() => {
    if (!accessToken) return;
    void Promise.resolve().then(() => {
      setError(null);
      return Promise.all([
        listStaff(accessToken),
        listRoles(accessToken),
        listBranches(accessToken),
      ])
        .then(([staffRes, roleRes, branchRes]) => {
          setStaff(staffRes.results);
          setRoles(roleRes.results);
          setBranches(branchRes.results);
        })
        .catch((err) => setError(err instanceof ApiError ? err.message : "Couldn't load staff."))
        .finally(() => setLoading(false));
    });
  }, [accessToken]);

  const submitInvite = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!accessToken || !inviteForm.role) return;
    setInviteError(null);
    setBusy(true);
    try {
      await inviteStaff(accessToken, {
        email: inviteForm.email,
        first_name: inviteForm.first_name,
        last_name: inviteForm.last_name,
        staff_id: inviteForm.staff_id || undefined,
        role: Number(inviteForm.role),
        primary_branch: inviteForm.primary_branch || undefined,
      });
      setInviteForm(EMPTY_INVITE);
      setShowInviteForm(false);
      await refreshStaff();
    } catch (err) {
      setInviteError(err instanceof ApiError ? err.message : "Couldn't invite this staff member.");
    } finally {
      setBusy(false);
    }
  };

  const handleToggleDuty = async (id: string) => {
    if (!accessToken) return;
    setError(null);
    try {
      const updated = await toggleStaffDuty(accessToken, id);
      setStaff((prev) => prev.map((s) => (s.id === id ? updated : s)));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't update duty status.");
    }
  };

  const handleDeactivate = async (id: string) => {
    if (!accessToken) return;
    setError(null);
    setBusy(true);
    try {
      await deactivateStaff(accessToken, id);
      await refreshStaff();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't deactivate this staff member.");
    } finally {
      setBusy(false);
    }
  };

  const visibleStaff = roleFilter ? staff.filter((s) => s.role_names.includes(roleFilter)) : staff;

  const initials = (s: Staff) => `${s.first_name.charAt(0)}${s.last_name.charAt(0)}`.toUpperCase();

  return (
    <div className="flex flex-col gap-6 animate-fade-in">
      <div>
        <div className="mb-1.5 text-[11px] font-bold uppercase tracking-wide text-brand-green">
          Org Admin · Team
        </div>
        <h1 className="font-display text-2xl font-bold text-ink-900">Staff / CCP Team</h1>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <label className={`${LABEL_CLASS} flex-row items-center gap-2`}>
          <span>Role</span>
          <select
            className={FIELD_CLASS}
            value={roleFilter}
            onChange={(e) => setRoleFilter(e.target.value)}
          >
            <option value="">All Roles</option>
            {roles.map((r) => (
              <option key={r.id} value={r.name}>
                {r.name}
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          className={`${BUTTON_CLASS} flex items-center gap-2`}
          onClick={() => setShowInviteForm((v) => !v)}
        >
          <UserPlus size={16} />
          Add Staff Member
        </button>
      </div>

      {showInviteForm && (
        <form onSubmit={submitInvite} className={CARD_CLASS}>
          <h2 className="mb-4 font-display text-base font-semibold text-ink-900">
            Invite Staff Member
          </h2>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <label className={LABEL_CLASS}>
              Email
              <input
                type="email"
                className={FIELD_CLASS}
                value={inviteForm.email}
                onChange={(e) => setInviteForm((f) => ({ ...f, email: e.target.value }))}
                required
              />
            </label>
            <label className={LABEL_CLASS}>
              First Name
              <input
                className={FIELD_CLASS}
                value={inviteForm.first_name}
                onChange={(e) => setInviteForm((f) => ({ ...f, first_name: e.target.value }))}
                required
              />
            </label>
            <label className={LABEL_CLASS}>
              Last Name
              <input
                className={FIELD_CLASS}
                value={inviteForm.last_name}
                onChange={(e) => setInviteForm((f) => ({ ...f, last_name: e.target.value }))}
                required
              />
            </label>
            <label className={LABEL_CLASS}>
              Staff ID (optional)
              <input
                className={FIELD_CLASS}
                value={inviteForm.staff_id}
                onChange={(e) => setInviteForm((f) => ({ ...f, staff_id: e.target.value }))}
              />
            </label>
            <label className={LABEL_CLASS}>
              Role
              <select
                className={FIELD_CLASS}
                value={inviteForm.role}
                onChange={(e) => setInviteForm((f) => ({ ...f, role: e.target.value }))}
                required
              >
                <option value="">Select a role…</option>
                {roles.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name}
                  </option>
                ))}
              </select>
            </label>
            <label className={LABEL_CLASS}>
              Primary Branch
              <select
                className={FIELD_CLASS}
                value={inviteForm.primary_branch}
                onChange={(e) => setInviteForm((f) => ({ ...f, primary_branch: e.target.value }))}
              >
                <option value="">Select a branch…</option>
                {branches.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
              </select>
            </label>
          </div>

          {inviteError && (
            <p className="mt-4 rounded-sm bg-status-red-tint px-3 py-2 text-sm text-status-red">
              {inviteError}
            </p>
          )}

          <div className="mt-4 flex gap-3">
            <button type="submit" disabled={busy} className={BUTTON_CLASS}>
              Send Invite
            </button>
            <button
              type="button"
              className="rounded-md border border-surface-border px-4 py-2 text-sm font-semibold text-ink-700 hover:bg-surface-bg"
              onClick={() => {
                setShowInviteForm(false);
                setInviteError(null);
                setInviteForm(EMPTY_INVITE);
              }}
            >
              Cancel
            </button>
          </div>
        </form>
      )}

      {loading && <p className="text-sm text-ink-500">Loading…</p>}

      {error && (
        <p className="rounded-sm bg-status-red-tint px-3 py-2 text-sm text-status-red">{error}</p>
      )}

      {!loading && (
        <div className="overflow-x-auto rounded-lg border border-surface-border bg-surface-card shadow-sm">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-surface-border bg-surface-bg text-xs font-semibold uppercase tracking-wide text-ink-500">
              <tr>
                <th className="px-4 py-3">Staff Member</th>
                <th className="px-4 py-3">Role(s)</th>
                <th className="px-4 py-3">Primary Branch</th>
                <th className="px-4 py-3">Duty Status</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Actions</th>
              </tr>
            </thead>
            <tbody>
              {visibleStaff.map((s) => (
                <tr key={s.id} className="border-b border-surface-border last:border-0">
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-3">
                      <span className="flex h-8 w-8 items-center justify-center rounded-md bg-brand-green-tint text-xs font-bold text-brand-green-dark">
                        {initials(s)}
                      </span>
                      <div>
                        <div className="font-medium text-ink-900">
                          {s.first_name} {s.last_name}
                        </div>
                        <div className="text-xs text-ink-500">{s.email}</div>
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-ink-700">{s.role_names.join(", ") || "—"}</td>
                  <td className="px-4 py-3 text-ink-700">{s.primary_branch_name ?? "—"}</td>
                  <td className="px-4 py-3">
                    <button
                      type="button"
                      onClick={() => handleToggleDuty(s.id)}
                      className={`rounded-sm px-2 py-0.5 text-xs font-semibold ${
                        s.is_on_duty
                          ? "bg-brand-green-tint text-brand-green-dark"
                          : "bg-surface-bg text-ink-500"
                      }`}
                    >
                      {s.is_on_duty ? "On Duty" : "Off Duty"}
                    </button>
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={`rounded-sm px-2 py-0.5 text-xs font-semibold ${
                        s.is_active
                          ? "bg-brand-green-tint text-brand-green-dark"
                          : "bg-status-red-tint text-status-red"
                      }`}
                    >
                      {s.is_active ? "Active" : "Inactive"}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    {s.is_active && (
                      <button
                        type="button"
                        disabled={busy}
                        className="text-sm font-semibold text-status-red hover:underline"
                        onClick={() => handleDeactivate(s.id)}
                      >
                        Deactivate
                      </button>
                    )}
                  </td>
                </tr>
              ))}
              {visibleStaff.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-4 py-10 text-center text-ink-500">
                    <div className="flex flex-col items-center gap-2">
                      <Users size={20} className="text-ink-400" />
                      No staff members found.
                    </div>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
