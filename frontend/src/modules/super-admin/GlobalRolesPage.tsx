import { useEffect, useState } from "react";
import { useAuth } from "../../auth/useAuth";
import { ApiError } from "../../lib/apiClient";
import { ConfirmDialog } from "../../components/ConfirmDialog";
import { PermissionChangeDialog, PermissionMatrix } from "../../components/PermissionMatrix";
import {
  invitePlatformStaff,
  listPermissions,
  listPlatformStaff,
  listRoles,
  listStaff,
  unlockPlatformStaff,
  unlockStaff,
  updateStaff,
  updateRole,
  type Permission,
  type Role,
  type Staff,
  type StaffInvitePayload,
} from "../../lib/governanceApi";
import { listOrganizations, type Organization } from "../../lib/organizationsApi";

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
 * "Global Roles & Permissions" — platform-level RBAC for Softlink's own
 * console users, plus the Platform Staff roster who get assigned into those
 * roles. citramac_SUPER-ADMIN.html "Global Roles & Permissions".
 */
export function GlobalRolesPage() {
  const { accessToken } = useAuth();
  const [roles, setRoles] = useState<Role[]>([]);
  const [permissions, setPermissions] = useState<Permission[]>([]);
  const [staff, setStaff] = useState<Staff[]>([]);
  const [organizations, setOrganizations] = useState<Organization[]>([]);
  const [selectedOrganizationId, setSelectedOrganizationId] = useState("");
  const [selectedRoleId, setSelectedRoleId] = useState<number | null>(null);
  const [selectedPermissionIds, setSelectedPermissionIds] = useState<number[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [unlockingId, setUnlockingId] = useState<string | null>(null);
  const [showInviteForm, setShowInviteForm] = useState(false);
  const [confirmSave, setConfirmSave] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [pendingStaffRole, setPendingStaffRole] = useState<{ staff: Staff; roleId: string } | null>(
    null,
  );
  const [invite, setInvite] = useState<StaffInvitePayload>(EMPTY_INVITE);

  const refresh = async (organizationId = selectedOrganizationId) => {
    if (!accessToken) return;
    const [roleRes, permissionRes, staffRes] = await Promise.all([
      listRoles(accessToken, organizationId || undefined),
      listPermissions(accessToken),
      organizationId ? listStaff(accessToken) : listPlatformStaff(accessToken),
    ]);
    setRoles(roleRes.results);
    setPermissions(permissionRes);
    setStaff(
      organizationId
        ? staffRes.results.filter((member) => member.organization === organizationId)
        : staffRes.results,
    );
    return roleRes.results;
  };

  useEffect(() => {
    if (!accessToken) return;
    void Promise.resolve().then(() =>
      Promise.all([refresh(), listOrganizations(accessToken)])
        .then(([loadedRoles, organizationRes]) => {
          setOrganizations(organizationRes.results);
          const initialRole = loadedRoles?.[0];
          if (initialRole) {
            setSelectedRoleId(initialRole.id);
            setSelectedPermissionIds(initialRole.permissions);
          }
        })
        .catch((err) =>
          setError(err instanceof ApiError ? err.message : "Couldn't load roles and permissions."),
        )
        .finally(() => setIsLoading(false)),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accessToken]);

  const visibleRoles = selectedOrganizationId
    ? roles.filter((role) => role.organization === selectedOrganizationId)
    : roles;

  const selectRole = (role: Role) => {
    setSelectedRoleId(role.id);
    setSelectedPermissionIds(role.permissions);
  };

  const selectedRole = visibleRoles.find((role) => role.id === selectedRoleId) ?? null;

  const changeOrganization = (organizationId: string) => {
    setSelectedOrganizationId(organizationId);
    setSelectedRoleId(null);
    setSelectedPermissionIds([]);
    setIsLoading(true);
    setError(null);
    void refresh(organizationId)
      .then((loadedRoles) => {
        const nextRole = loadedRoles?.[0];
        if (nextRole) {
          setSelectedRoleId(nextRole.id);
          setSelectedPermissionIds(nextRole.permissions);
        }
      })
      .catch((err) =>
        setError(err instanceof ApiError ? err.message : "Couldn't load organization roles."),
      )
      .finally(() => setIsLoading(false));
  };

  const togglePermission = (permissionId: number) => {
    setSelectedPermissionIds((prev) =>
      prev.includes(permissionId)
        ? prev.filter((id) => id !== permissionId)
        : [...prev, permissionId],
    );
  };

  const permissionsDirty =
    selectedRole !== null &&
    (selectedPermissionIds.length !== selectedRole.permissions.length ||
      selectedPermissionIds.some((id) => !selectedRole.permissions.includes(id)));

  // A platform-team role takes platform permissions; every other role takes
  // the organisation permissions (the server refuses any other mix).
  const rolePermissions = selectedRole
    ? permissions.filter((p) =>
        selectedRole.scope === "PLATFORM" && selectedRole.organization === null
          ? p.scope === "PLATFORM" || p.scope === "ORG"
          : p.scope === "ORG",
      )
    : [];

  const builtIn =
    selectedRole !== null &&
    ["org admin", "auditor"].includes(selectedRole.name.trim().toLowerCase());

  const saveRolePermissions = async () => {
    if (!accessToken || !selectedRole) return;
    setSaveError(null);
    setBusy(true);
    try {
      await updateRole(accessToken, selectedRole.id, { permissions: selectedPermissionIds });
      const refreshed = await refresh();
      const updated = refreshed?.find((r) => r.id === selectedRole.id);
      if (updated) setSelectedPermissionIds(updated.permissions);
      setConfirmSave(false);
    } catch (err) {
      setSaveError(err instanceof ApiError ? err.message : "Couldn't save role permissions.");
    } finally {
      setBusy(false);
    }
  };

  const assignStaffRole = async () => {
    if (!accessToken || !pendingStaffRole) return;
    const { staff: member, roleId } = pendingStaffRole;
    setError(null);
    setBusy(true);
    try {
      const updated = await updateStaff(accessToken, member.id, { roles: [Number(roleId)] });
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
      // Mirrors refresh()'s org-vs-platform split: StaffViewSet never
      // includes organization=None rows, so an org-scoped call would 404
      // on a platform-staff row and vice versa.
      const updated = selectedOrganizationId
        ? await unlockStaff(accessToken, member.id)
        : await unlockPlatformStaff(accessToken, member.id);
      setStaff((current) => current.map((row) => (row.id === member.id ? updated : row)));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't unlock this account.");
    } finally {
      setUnlockingId(null);
    }
  };

  const submitInvite = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!accessToken || !invite.role) return;
    setError(null);
    setBusy(true);
    try {
      await invitePlatformStaff(accessToken, invite);
      setInvite(EMPTY_INVITE);
      setShowInviteForm(false);
      await refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't invite the staff member.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-6 animate-fade-in">
      <div>
        <div className="mb-1.5 text-[11px] font-bold uppercase tracking-wide text-brand-green">
          Platform Console
        </div>
        <h1 className="font-display text-2xl font-bold text-ink-900">
          Global Roles &amp; Permissions
        </h1>
      </div>

      {error && (
        <p className="rounded-sm bg-status-red-tint px-3 py-2 text-sm text-status-red">{error}</p>
      )}

      {isLoading && visibleRoles.length === 0 && <p className="text-sm text-ink-500">Loading…</p>}

      <div className="flex flex-wrap items-end gap-3 rounded-lg border border-surface-border bg-surface-card p-4 shadow-sm">
        <label className={LABEL_CLASS}>
          Role scope
          <select
            className={FIELD_CLASS}
            value={selectedOrganizationId}
            onChange={(event) => changeOrganization(event.target.value)}
          >
            <option value="">All roles</option>
            {organizations.map((organization) => (
              <option key={organization.id} value={organization.id}>
                {organization.name} roles
              </option>
            ))}
          </select>
        </label>
        <p className="text-sm text-ink-500">
          {selectedOrganizationId
            ? "Showing this organization's custom roles and available templates."
            : "Showing all platform and organization roles."}
        </p>
      </div>

      {!isLoading && visibleRoles.length === 0 && (
        <div className="rounded-lg border border-surface-border bg-surface-card p-6 shadow-sm">
          <p className="text-sm text-ink-500">No roles have been configured for this scope.</p>
        </div>
      )}

      {visibleRoles.length > 0 && (
        <div className="rounded-lg border border-surface-border bg-surface-card p-6 shadow-sm">
          <h2 className="mb-4 font-display text-base font-semibold text-ink-900">Roles</h2>

          <div className="flex flex-wrap gap-2">
            {visibleRoles.map((role) => (
              <button
                key={role.id}
                type="button"
                onClick={() => selectRole(role)}
                className={`rounded-full px-4 py-1.5 text-sm font-semibold transition-colors ${
                  role.id === selectedRoleId
                    ? "bg-brand-green text-on-primary"
                    : "border border-surface-border text-ink-700 hover:bg-surface-bg"
                }`}
              >
                {role.name}
                {role.organization_name ? ` · ${role.organization_name}` : " · Platform"}
                <span
                  className={`ml-1.5 text-xs ${
                    role.id === selectedRoleId ? "text-on-primary opacity-80" : "text-ink-500"
                  }`}
                >
                  ({role.user_count})
                </span>
              </button>
            ))}
          </div>

          {selectedRole && (
            <div className="mt-5 flex flex-col gap-4">
              {selectedRole.description && (
                <div className="rounded-md border border-surface-border bg-brand-green-tint-2 p-3 text-sm text-ink-700">
                  {selectedRole.description}
                </div>
              )}

              <PermissionMatrix
                permissions={rolePermissions}
                selected={new Set(selectedPermissionIds)}
                disabled={builtIn}
                onToggle={togglePermission}
              />
              {builtIn && (
                <p className="text-xs text-ink-500">
                  {selectedRole.name} is a built-in administrator role; its access is fixed in code
                  and can&apos;t be changed here.
                </p>
              )}

              <div>
                <button
                  type="button"
                  className="rounded-md bg-brand-green px-4 py-2 text-sm font-semibold text-on-primary shadow-sm hover:bg-brand-green-dark disabled:opacity-60"
                  disabled={busy || builtIn || !permissionsDirty}
                  onClick={() => {
                    setSaveError(null);
                    setConfirmSave(true);
                  }}
                >
                  Save Changes
                </button>
              </div>
              <PermissionChangeDialog
                open={confirmSave}
                roleName={selectedRole.name}
                userCount={selectedRole.user_count ?? null}
                permissions={permissions}
                before={new Set(selectedRole.permissions)}
                after={new Set(selectedPermissionIds)}
                busy={busy}
                error={saveError}
                onConfirm={saveRolePermissions}
                onCancel={() => setConfirmSave(false)}
              />
            </div>
          )}
        </div>
      )}

      <div className="overflow-x-auto rounded-lg border border-surface-border bg-surface-card shadow-sm">
        <div className="flex items-center justify-between px-6 pt-6">
          <h2 className="font-display text-base font-semibold text-ink-900">
            {selectedOrganizationId ? "Organization Staff" : "Platform Staff"}
          </h2>
          <button
            type="button"
            onClick={() => setShowInviteForm((prev) => !prev)}
            className={SECONDARY_BUTTON_CLASS}
          >
            {showInviteForm ? "Cancel" : "Add Staff"}
          </button>
        </div>

        {showInviteForm && (
          <form
            onSubmit={submitInvite}
            className="mx-6 mt-4 flex flex-wrap items-end gap-3 rounded-md border border-surface-border bg-surface-bg p-4"
          >
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
                {visibleRoles.map((role) => (
                  <option key={role.id} value={role.id}>
                    {role.name}
                  </option>
                ))}
              </select>
            </label>
            <button type="submit" disabled={busy} className={BUTTON_CLASS}>
              Send Invite
            </button>
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
                  <select
                    className={FIELD_CLASS}
                    value={s.roles[0] ?? ""}
                    disabled={busy || visibleRoles.length === 0}
                    onChange={(event) =>
                      event.target.value &&
                      setPendingStaffRole({ staff: s, roleId: event.target.value })
                    }
                  >
                    <option value="">No role</option>
                    {visibleRoles.map((role) => (
                      <option key={role.id} value={role.id}>
                        {role.name}
                      </option>
                    ))}
                  </select>
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
                      {s.is_active ? "Active" : "Inactive"}
                    </span>
                    {s.is_locked && (
                      <span className="rounded-full bg-status-red-tint px-2 py-0.5 text-xs font-semibold text-status-red">
                        Locked
                      </span>
                    )}
                  </div>
                </td>
                <td className="px-6 py-3 text-ink-700">
                  {s.last_login ? new Date(s.last_login).toLocaleString() : "Never"}
                </td>
                <td className="px-6 py-3">
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
                </td>
              </tr>
            ))}
            {staff.length === 0 && (
              <tr>
                <td colSpan={6} className="px-6 py-6 text-center text-ink-500">
                  No platform staff yet.
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
