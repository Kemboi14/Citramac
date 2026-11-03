import { useEffect, useState } from "react";
import { useAuth } from "../../auth/useAuth";
import { ApiError } from "../../lib/apiClient";
import { ConfirmDialog } from "../../components/ConfirmDialog";
import { InviteEmailPill } from "../../components/InviteEmailPill";
import { RolesWorkspace } from "../../components/RolesWorkspace";
import {
  changePlatformStaffRole,
  invitePlatformStaff,
  listPlatformStaff,
  resendPlatformStaffInvite,
  unlockPlatformStaff,
  type Role,
  type Staff,
  type StaffInvitePayload,
} from "../../lib/governanceApi";

const FIELD_CLASS =
  "rounded-sm border border-surface-border bg-surface-card px-3 py-2 text-sm text-ink-900 outline-none transition-colors duration-150 focus:border-brand-green";
const LABEL_CLASS = "flex flex-col gap-1.5 text-sm font-medium text-ink-700";
const BUTTON_CLASS =
  "rounded-md bg-brand-green px-4 py-2 text-sm font-semibold text-on-primary shadow-sm hover:bg-brand-green-dark active:scale-[0.98] disabled:opacity-60 disabled:active:scale-100 transition-all duration-150";
const SECONDARY_BUTTON_CLASS =
  "rounded-md border border-surface-border px-4 py-2 text-sm font-semibold text-ink-700 hover:bg-surface-bg active:scale-[0.98] disabled:opacity-60 disabled:active:scale-100 transition-all duration-150";

const EMPTY_INVITE: StaffInvitePayload = {
  email: "",
  first_name: "",
  last_name: "",
  role: 0,
};

/**
 * Super Admin → Platform Roles & Team: Softlink Options' own team only — its
 * roles (platform permissions only) and the people in it. Organisations'
 * roles are theirs, in each organisation's own Roles & Permissions; staff are
 * added to an organisation from the Organizations screen.
 */
export function GlobalRolesPage() {
  const { accessToken } = useAuth();
  const [roles, setRoles] = useState<Role[]>([]);
  const [staff, setStaff] = useState<Staff[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [unlockingId, setUnlockingId] = useState<string | null>(null);
  const [showInviteForm, setShowInviteForm] = useState(false);
  const [pendingStaffRole, setPendingStaffRole] = useState<{ staff: Staff; roleId: string } | null>(
    null,
  );
  const [invite, setInvite] = useState<StaffInvitePayload>(EMPTY_INVITE);
  const [inviteError, setInviteError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [resendingId, setResendingId] = useState<string | null>(null);

  const refreshStaff = async () => {
    if (!accessToken) return;
    const res = await listPlatformStaff(accessToken);
    setStaff(res.results);
  };

  useEffect(() => {
    if (!accessToken) return;
    void Promise.resolve().then(() =>
      refreshStaff().catch((err) =>
        setError(err instanceof ApiError ? err.message : "Couldn't load the platform team."),
      ),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accessToken]);

  // Super Admin comes with a Super Admin account; it is never handed out.
  const inviteRoles = roles.filter((role) => role.is_active && role.system_key !== "super_admin");

  const assignStaffRole = async () => {
    if (!accessToken || !pendingStaffRole) return;
    const { staff: member, roleId } = pendingStaffRole;
    setError(null);
    setBusy(true);
    try {
      const updated = await changePlatformStaffRole(accessToken, member.id, Number(roleId));
      setStaff((current) => current.map((row) => (row.id === member.id ? updated : row)));
      setPendingStaffRole(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't assign this role.");
    } finally {
      setBusy(false);
    }
  };
  const roleName = (id: number | string | undefined) =>
    roles.find((r) => String(r.id) === String(id))?.name ?? "no role";

  const handleUnlock = async (member: Staff) => {
    if (!accessToken) return;
    setError(null);
    setUnlockingId(member.id);
    try {
      const updated = await unlockPlatformStaff(accessToken, member.id);
      setStaff((current) => current.map((row) => (row.id === member.id ? updated : row)));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't unlock this account.");
    } finally {
      setUnlockingId(null);
    }
  };

  const submitInvite = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!accessToken) return;
    if (!invite.role) {
      setInviteError("Choose a role for this person.");
      return;
    }
    setInviteError(null);
    setNotice(null);
    setBusy(true);
    try {
      const created = await invitePlatformStaff(accessToken, invite);
      setInvite(EMPTY_INVITE);
      setShowInviteForm(false);
      setNotice(
        `${created.first_name} ${created.last_name} was added. Their invite email is queued — its status shows on their row.`,
      );
      await refreshStaff();
    } catch (err) {
      setInviteError(err instanceof ApiError ? err.message : "Couldn't add this person.");
    } finally {
      setBusy(false);
    }
  };

  const handleResendInvite = async (member: Staff) => {
    if (!accessToken) return;
    setError(null);
    setNotice(null);
    setResendingId(member.id);
    try {
      const updated = await resendPlatformStaffInvite(accessToken, member.id);
      setStaff((current) => current.map((row) => (row.id === member.id ? updated : row)));
      setNotice(`A new invite email to ${member.email} is queued.`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't resend the invite.");
    } finally {
      setResendingId(null);
    }
  };

  return (
    <div className="flex flex-col gap-6 animate-fade-in">
      <div>
        <div className="mb-1.5 text-[11px] font-bold uppercase tracking-wide text-brand-green">
          Platform Console
        </div>
        <h1 className="font-display text-2xl font-bold text-ink-900">Platform Roles &amp; Team</h1>
        <p className="mt-1 text-sm text-ink-500">
          Softlink Options&apos; own team and its roles. Each organisation manages its own roles in
          its Roles &amp; Permissions; add staff to an organisation from Organizations.
        </p>
      </div>

      <RolesWorkspace mode="platform" onRolesChange={setRoles} />

      {error && (
        <p className="rounded-sm bg-status-red-tint px-3 py-2 text-sm text-status-red">{error}</p>
      )}

      <div className="overflow-x-auto rounded-lg border border-surface-border bg-surface-card shadow-sm">
        <div className="flex items-center justify-between px-6 pt-6">
          <h2 className="font-display text-base font-semibold text-ink-900">
            Platform team
          </h2>
          <button
            type="button"
            onClick={() => {
              setShowInviteForm((prev) => !prev);
              setInviteError(null);
            }}
            className={SECONDARY_BUTTON_CLASS}
          >
            {showInviteForm ? "Cancel" : "Add Staff"}
          </button>
        </div>

        {notice && (
          <p
            role="status"
            className="mx-6 mt-4 rounded-sm bg-brand-green-tint px-3 py-2 text-sm text-brand-green-dark"
          >
            {notice}
          </p>
        )}

        {showInviteForm && (
          <form
            onSubmit={submitInvite}
            className="mx-6 mt-4 flex flex-wrap items-end gap-3 rounded-md border border-surface-border bg-surface-bg p-4"
          >
            <p className="w-full text-sm text-ink-500">
              Adds a member of the Softlink Options platform team. To add someone to an
              organisation, use Add Staff on the Organizations screen.
            </p>
            <label className={LABEL_CLASS}>
              First name
              <input
                className={FIELD_CLASS}
                value={invite.first_name}
                onChange={(e) => setInvite({ ...invite, first_name: e.target.value })}
                required
              />
            </label>
            <label className={LABEL_CLASS}>
              Last name
              <input
                className={FIELD_CLASS}
                value={invite.last_name}
                onChange={(e) => setInvite({ ...invite, last_name: e.target.value })}
                required
              />
            </label>
            <label className={LABEL_CLASS}>
              Email
              <input
                type="email"
                className={FIELD_CLASS}
                value={invite.email}
                onChange={(e) => setInvite({ ...invite, email: e.target.value })}
                required
              />
            </label>
            <label className={LABEL_CLASS}>
              Role
              <select
                className={FIELD_CLASS}
                value={invite.role || ""}
                onChange={(e) => setInvite({ ...invite, role: Number(e.target.value) })}
                required
              >
                <option value="">Select a role…</option>
                {inviteRoles.map((role) => (
                  <option key={role.id} value={role.id}>
                    {role.name}
                  </option>
                ))}
              </select>
            </label>
            <button type="submit" disabled={busy} className={BUTTON_CLASS}>
              {busy ? "Adding…" : "Add and send invite"}
            </button>
            {inviteRoles.length === 0 && (
              <p className="w-full text-sm text-status-amber">
                There are no roles to offer here yet.
              </p>
            )}
            {inviteError && (
              <p
                role="alert"
                className="w-full rounded-sm bg-status-red-tint px-3 py-2 text-sm text-status-red"
              >
                {inviteError}
              </p>
            )}
          </form>
        )}

        <table className="mt-4 w-full text-left text-sm">
          <thead className="border-b border-surface-border text-xs font-semibold uppercase tracking-wide text-ink-500">
            <tr>
              <th className="px-6 py-3">Name</th>
              <th className="px-6 py-3">Email</th>
              <th className="px-6 py-3">Assign Role</th>
              <th className="px-6 py-3">Status</th>
              <th className="px-6 py-3">Last Login</th>
              <th className="px-6 py-3">Actions</th>
            </tr>
          </thead>
          <tbody>
            {staff.map((s) => (
              <tr key={s.id} className="border-b border-surface-border last:border-0">
                <td className="px-6 py-3 font-medium text-ink-900">
                  {s.first_name} {s.last_name}
                </td>
                <td className="px-6 py-3 text-ink-700">{s.email}</td>
                <td className="px-6 py-3">
                  {s.is_superuser ? (
                    <span className="text-ink-700">Super Admin</span>
                  ) : (
                    <select
                      className={FIELD_CLASS}
                      aria-label={`Role for ${s.first_name} ${s.last_name}`}
                      value={s.roles[0] ?? ""}
                      disabled={busy || inviteRoles.length === 0}
                      onChange={(event) =>
                        event.target.value &&
                        setPendingStaffRole({ staff: s, roleId: event.target.value })
                      }
                    >
                      <option value="">No role</option>
                      {s.roles[0] !== undefined &&
                        !inviteRoles.some((role) => role.id === s.roles[0]) && (
                          <option value={s.roles[0]} disabled>
                            {roleName(s.roles[0])}
                          </option>
                        )}
                      {inviteRoles.map((role) => (
                        <option key={role.id} value={role.id}>
                          {role.name}
                        </option>
                      ))}
                    </select>
                  )}
                </td>
                <td className="px-6 py-3">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span
                      className={`rounded-full px-2 py-0.5 text-xs font-semibold ${
                        s.is_active
                          ? "bg-brand-green-tint text-brand-green-dark"
                          : "bg-status-red-tint text-status-red"
                      }`}
                    >
                      {s.is_active ? "Active" : s.last_login ? "Inactive" : "Invite pending"}
                    </span>
                    {s.is_locked && (
                      <span className="rounded-full bg-status-red-tint px-2 py-0.5 text-xs font-semibold text-status-red">
                        Locked
                      </span>
                    )}
                    <InviteEmailPill invite={s.invite_email} />
                  </div>
                </td>
                <td className="px-6 py-3 text-ink-700">
                  {s.last_login ? new Date(s.last_login).toLocaleString() : "Never"}
                </td>
                <td className="px-6 py-3">
                  <div className="flex flex-wrap gap-3">
                    {!s.is_active && !s.last_login && (
                      <button
                        type="button"
                        disabled={resendingId === s.id}
                        className="text-sm font-semibold text-brand-green hover:underline disabled:opacity-60"
                        onClick={() => handleResendInvite(s)}
                      >
                        {resendingId === s.id ? "Sending…" : "Resend invite"}
                      </button>
                    )}
                    {s.is_locked && (
                      <button
                        type="button"
                        disabled={unlockingId === s.id}
                        className="text-sm font-semibold text-brand-green hover:underline disabled:opacity-60"
                        onClick={() => handleUnlock(s)}
                      >
                        {unlockingId === s.id ? "Unlocking…" : "Unlock"}
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
            {staff.length === 0 && (
              <tr>
                <td colSpan={6} className="px-6 py-6 text-center text-ink-500">
                  No platform team members yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <ConfirmDialog
        open={pendingStaffRole !== null}
        title="Change this person's role?"
        confirmLabel="Yes, change role"
        busyLabel="Saving…"
        busy={busy}
        error={error}
        onConfirm={assignStaffRole}
        onCancel={() => setPendingStaffRole(null)}
      >
        {pendingStaffRole && (
          <p className="text-sm text-ink-700">
            {pendingStaffRole.staff.first_name} {pendingStaffRole.staff.last_name} will change from{" "}
            <strong>{roleName(pendingStaffRole.staff.roles[0])}</strong> to{" "}
            <strong>{roleName(pendingStaffRole.roleId)}</strong>, and from their next action will
            have exactly that role&apos;s permissions.
          </p>
        )}
      </ConfirmDialog>
    </div>
  );
}
