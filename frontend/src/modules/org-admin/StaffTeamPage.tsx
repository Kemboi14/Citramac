import { useEffect, useState } from "react";
import { UserPlus } from "lucide-react";
import { useAuth } from "../../auth/useAuth";
import { ApiError } from "../../lib/apiClient";
import { listBranches, type Branch } from "../../lib/branchesApi";
import { listDepartments, type Department } from "../../lib/departmentsApi";
import {
  deactivateStaff,
  inviteStaff,
  listRoles,
  listStaff,
  resendStaffInvite,
  resetStaffCredentials,
  toggleStaffDuty,
  unlockStaff,
  updateStaff,
  type Role,
  type Staff,
} from "../../lib/governanceApi";
import { Drawer } from "../../components/Drawer";
import { SaveButton } from "../../components/SaveButton";
import { ResponsiveTable, type ResponsiveTableColumn } from "../../components/ResponsiveTable";

const FIELD_CLASS =
  "rounded-sm border border-surface-border bg-surface-card px-3 py-2 text-sm text-ink-900 outline-none transition-colors duration-150 focus:border-brand-green";
const LABEL_CLASS = "flex flex-col gap-1.5 text-sm font-medium text-ink-700";
const BUTTON_CLASS =
  "rounded-md bg-brand-green px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-brand-green-dark active:scale-[0.98] disabled:opacity-60 disabled:active:scale-100 transition-all duration-150";
const CARD_CLASS = "rounded-lg border border-surface-border bg-surface-card p-6 shadow-sm";

const ACCESS_STATUS_TINT: Record<string, string> = {
  not_started: "bg-status-amber-tint text-status-amber",
  active: "bg-brand-green-tint text-brand-green-dark",
  expired: "bg-status-red-tint text-status-red",
};
const ACCESS_STATUS_LABEL: Record<string, string> = {
  not_started: "Access not started",
  active: "Access time-limited",
  expired: "Access expired",
};

const EMPTY_INVITE = {
  email: "",
  first_name: "",
  last_name: "",
  staff_id: "",
  role: "",
  primary_branch: "",
  department: "",
  access_starts_at: "",
  access_ends_at: "",
};

interface AccessEditState {
  primary_branch: string;
  department: string;
  access_starts_at: string;
  access_ends_at: string;
}

function toDatetimeLocalInput(value: string | null) {
  if (!value) return "";
  return value.slice(0, 16);
}

/**
 * Org Admin's staff roster — doctors, nurses, therapists, supervisors.
 * citramac_ORG-admin.html "Staff / MHP Team".
 */
export function StaffTeamPage() {
  const { accessToken } = useAuth();
  const [staff, setStaff] = useState<Staff[]>([]);
  const [roles, setRoles] = useState<Role[]>([]);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [resendingId, setResendingId] = useState<string | null>(null);
  const [unlockingId, setUnlockingId] = useState<string | null>(null);
  const [activatingId, setActivatingId] = useState<string | null>(null);
  const [resettingId, setResettingId] = useState<string | null>(null);

  const [roleFilter, setRoleFilter] = useState("");
  const [showInviteForm, setShowInviteForm] = useState(false);
  const [inviteForm, setInviteForm] = useState(EMPTY_INVITE);
  const [inviteError, setInviteError] = useState<string | null>(null);

  const [accessDrawer, setAccessDrawer] = useState<{ open: boolean; staff: Staff | null }>({
    open: false,
    staff: null,
  });
  const [accessForm, setAccessForm] = useState<AccessEditState>({
    primary_branch: "",
    department: "",
    access_starts_at: "",
    access_ends_at: "",
  });
  const [accessError, setAccessError] = useState<string | null>(null);

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
        listDepartments(accessToken),
      ])
        .then(([staffRes, roleRes, branchRes, deptRes]) => {
          setStaff(staffRes.results);
          setRoles(roleRes.results);
          setBranches(branchRes.results);
          setDepartments(deptRes.results);
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
        department: inviteForm.department || undefined,
        access_starts_at: inviteForm.access_starts_at || undefined,
        access_ends_at: inviteForm.access_ends_at || undefined,
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

  const openAccessDrawer = (s: Staff) => {
    setAccessError(null);
    setAccessForm({
      primary_branch: s.primary_branch ?? "",
      department: s.department ?? "",
      access_starts_at: toDatetimeLocalInput(s.access_starts_at),
      access_ends_at: toDatetimeLocalInput(s.access_ends_at),
    });
    setAccessDrawer({ open: true, staff: s });
  };

  const saveAccessDrawer = async () => {
    if (!accessToken || !accessDrawer.staff) return;
    setAccessError(null);
    try {
      const updated = await updateStaff(accessToken, accessDrawer.staff.id, {
        primary_branch: accessForm.primary_branch || null,
        department: accessForm.department || null,
        access_starts_at: accessForm.access_starts_at || null,
        access_ends_at: accessForm.access_ends_at || null,
      });
      setStaff((prev) => prev.map((row) => (row.id === updated.id ? updated : row)));
      setAccessDrawer({ open: false, staff: null });
    } catch (err) {
      setAccessError(
        err instanceof ApiError ? err.message : "Couldn't update this staff member's assignment.",
      );
      throw err;
    }
  };

  const handleActivate = async (s: Staff) => {
    if (!accessToken) return;
    setError(null);
    setActivatingId(s.id);
    try {
      const updated = await updateStaff(accessToken, s.id, { is_active: true });
      setStaff((prev) => prev.map((row) => (row.id === s.id ? updated : row)));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't reactivate this account.");
    } finally {
      setActivatingId(null);
    }
  };

  const handleResetCredentials = async (s: Staff) => {
    if (!accessToken) return;
    setError(null);
    setNotice(null);
    setResettingId(s.id);
    try {
      await resetStaffCredentials(accessToken, s.id);
      setNotice(`A password reset code has been emailed to ${s.email}.`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't reset this account's credentials.");
    } finally {
      setResettingId(null);
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

  const handleResendInvite = async (s: Staff) => {
    if (!accessToken) return;
    setError(null);
    setNotice(null);
    setResendingId(s.id);
    try {
      await resendStaffInvite(accessToken, s.id);
      setNotice(`Invite resent to ${s.email}.`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't resend the invite.");
    } finally {
      setResendingId(null);
    }
  };

  const handleUnlock = async (s: Staff) => {
    if (!accessToken) return;
    setError(null);
    setNotice(null);
    setUnlockingId(s.id);
    try {
      const updated = await unlockStaff(accessToken, s.id);
      setStaff((prev) => prev.map((row) => (row.id === s.id ? updated : row)));
      setNotice(`${s.first_name} ${s.last_name}'s account has been unlocked.`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't unlock this account.");
    } finally {
      setUnlockingId(null);
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

  const staffColumns: ResponsiveTableColumn<Staff>[] = [
    {
      key: "member",
      header: "Staff Member",
      cardTitle: true,
      cell: (s) => (
        <div className="flex items-center gap-3">
          <span className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-md bg-brand-green-tint text-xs font-bold text-brand-green-dark">
            {initials(s)}
          </span>
          <div>
            <div className="font-medium text-ink-900">
              {s.first_name} {s.last_name}
            </div>
            <div className="text-xs text-ink-500">{s.email}</div>
          </div>
        </div>
      ),
    },
    {
      key: "roles",
      header: "Role(s)",
      cell: (s) => s.role_names.join(", ") || "—",
    },
    {
      key: "branch",
      header: "Branch / Department",
      cell: (s) => (
        <div>
          <div>{s.primary_branch_name ?? "—"}</div>
          {s.department_name && <div className="text-xs text-ink-500">{s.department_name}</div>}
        </div>
      ),
    },
    {
      key: "duty",
      header: "Duty Status",
      cell: (s) => (
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
      ),
    },
    {
      key: "status",
      header: "Status",
      cardBadge: true,
      cell: (s) => (
        <div className="flex flex-wrap items-center gap-1.5">
          <span
            className={`rounded-sm px-2 py-0.5 text-xs font-semibold ${
              s.is_active
                ? "bg-brand-green-tint text-brand-green-dark"
                : "bg-status-red-tint text-status-red"
            }`}
          >
            {s.is_active ? "Active" : "Inactive"}
          </span>
          {s.is_locked && (
            <span className="rounded-sm bg-status-red-tint px-2 py-0.5 text-xs font-semibold text-status-red">
              Locked
            </span>
          )}
          {s.access_status && (
            <span
              className={`rounded-sm px-2 py-0.5 text-xs font-semibold ${ACCESS_STATUS_TINT[s.access_status]}`}
            >
              {ACCESS_STATUS_LABEL[s.access_status]}
            </span>
          )}
        </div>
      ),
    },
    {
      key: "actions",
      header: "Actions",
      hideInCard: true,
      cell: (s) => (
        <div className="flex flex-wrap items-center gap-3">{staffRowActions(s)}</div>
      ),
    },
  ];

  function staffRowActions(s: Staff, cardLayout = false) {
    const itemClass = cardLayout ? "flex-1 text-center text-sm font-semibold" : "text-sm font-semibold";
    return (
      <>
        {s.is_active ? (
          <button
            type="button"
            disabled={busy}
            className={`${itemClass} text-status-red hover:underline`}
            onClick={() => handleDeactivate(s.id)}
          >
            Deactivate
          </button>
        ) : s.last_login ? (
          <button
            type="button"
            disabled={activatingId === s.id}
            className={`${itemClass} text-brand-green hover:underline disabled:opacity-60`}
            onClick={() => handleActivate(s)}
          >
            {activatingId === s.id ? "Activating…" : "Activate"}
          </button>
        ) : (
          <button
            type="button"
            disabled={resendingId === s.id}
            className={`${itemClass} text-brand-green hover:underline disabled:opacity-60`}
            onClick={() => handleResendInvite(s)}
          >
            {resendingId === s.id ? "Sending…" : "Resend Invite"}
          </button>
        )}
        {s.is_active && (
          <button
            type="button"
            disabled={resettingId === s.id}
            className={`${itemClass} text-brand-green hover:underline disabled:opacity-60`}
            onClick={() => handleResetCredentials(s)}
          >
            {resettingId === s.id ? "Sending…" : "Reset Credentials"}
          </button>
        )}
        {s.is_locked && (
          <button
            type="button"
            disabled={unlockingId === s.id}
            className={`${itemClass} text-brand-green hover:underline disabled:opacity-60`}
            onClick={() => handleUnlock(s)}
          >
            {unlockingId === s.id ? "Unlocking…" : "Unlock"}
          </button>
        )}
        <button
          type="button"
          className={`${itemClass} text-ink-700 hover:underline`}
          onClick={() => openAccessDrawer(s)}
        >
          Branch / Access…
        </button>
      </>
    );
  }

  const staffCardActions = (s: Staff) => <>{staffRowActions(s, true)}</>;

  return (
    <div className="flex flex-col gap-6 animate-fade-in">
      <div>
        <div className="mb-1.5 text-[11px] font-bold uppercase tracking-wide text-brand-green">
          Org Admin · Team
        </div>
        <h1 className="font-display text-2xl font-bold text-ink-900">Staff / MHP Team</h1>
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
            <label className={LABEL_CLASS}>
              Department
              <select
                className={FIELD_CLASS}
                value={inviteForm.department}
                onChange={(e) => setInviteForm((f) => ({ ...f, department: e.target.value }))}
              >
                <option value="">Select a department…</option>
                {departments.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <div className="mt-4">
            <h3 className="mb-2 text-[11.5px] font-semibold text-ink-700">
              Access window (optional — for a locum or fixed-term account)
            </h3>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <label className={LABEL_CLASS}>
                Access starts
                <input
                  type="datetime-local"
                  className={FIELD_CLASS}
                  value={inviteForm.access_starts_at}
                  onChange={(e) =>
                    setInviteForm((f) => ({ ...f, access_starts_at: e.target.value }))
                  }
                />
              </label>
              <label className={LABEL_CLASS}>
                Access ends
                <input
                  type="datetime-local"
                  className={FIELD_CLASS}
                  value={inviteForm.access_ends_at}
                  onChange={(e) => setInviteForm((f) => ({ ...f, access_ends_at: e.target.value }))}
                />
              </label>
            </div>
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
      {notice && (
        <p className="rounded-sm bg-brand-green-tint px-3 py-2 text-sm text-brand-green-dark">
          {notice}
        </p>
      )}

      {!loading && (
        <ResponsiveTable
          columns={staffColumns}
          rows={visibleStaff}
          rowKey={(s) => s.id}
          renderCardActions={staffCardActions}
          emptyMessage="No staff members found."
        />
      )}

      <Drawer
        open={accessDrawer.open}
        title="Branch, Department & Access"
        subtitle={
          accessDrawer.staff ? `${accessDrawer.staff.first_name} ${accessDrawer.staff.last_name}` : undefined
        }
        onClose={() => setAccessDrawer({ open: false, staff: null })}
        footer={
          <>
            <button
              type="button"
              className="rounded-md border border-surface-border px-4 py-2 text-sm font-semibold text-ink-700 hover:bg-surface-bg"
              onClick={() => setAccessDrawer({ open: false, staff: null })}
            >
              Cancel
            </button>
            <SaveButton onSave={saveAccessDrawer} className="flex-1">
              Save changes
            </SaveButton>
          </>
        }
      >
        <div className="flex flex-col gap-4">
          <label className={LABEL_CLASS}>
            Primary Branch
            <select
              className={FIELD_CLASS}
              value={accessForm.primary_branch}
              onChange={(e) => setAccessForm((f) => ({ ...f, primary_branch: e.target.value }))}
            >
              <option value="">Unassigned</option>
              {branches.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </select>
          </label>
          <label className={LABEL_CLASS}>
            Department
            <select
              className={FIELD_CLASS}
              value={accessForm.department}
              onChange={(e) => setAccessForm((f) => ({ ...f, department: e.target.value }))}
            >
              <option value="">Unassigned</option>
              {departments.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </select>
          </label>
          <div>
            <h3 className="mb-2 text-[11.5px] font-semibold text-ink-700">
              Access window (optional — for a locum or fixed-term account)
            </h3>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <label className={LABEL_CLASS}>
                Access starts
                <input
                  type="datetime-local"
                  className={FIELD_CLASS}
                  value={accessForm.access_starts_at}
                  onChange={(e) =>
                    setAccessForm((f) => ({ ...f, access_starts_at: e.target.value }))
                  }
                />
              </label>
              <label className={LABEL_CLASS}>
                Access ends
                <input
                  type="datetime-local"
                  className={FIELD_CLASS}
                  value={accessForm.access_ends_at}
                  onChange={(e) => setAccessForm((f) => ({ ...f, access_ends_at: e.target.value }))}
                />
              </label>
            </div>
          </div>
          {accessError && (
            <p className="rounded-sm bg-status-red-tint px-3 py-2 text-sm text-status-red">
              {accessError}
            </p>
          )}
        </div>
      </Drawer>
    </div>
  );
}
