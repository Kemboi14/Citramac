import { useEffect, useState } from "react";
import { useAuth } from "../../auth/useAuth";
import { ApiError } from "../../lib/apiClient";
import {
  invitePlatformStaff,
  listPermissions,
  listPlatformStaff,
  listRoles,
  updateRole,
  type Permission,
  type Role,
  type Staff,
  type StaffInvitePayload,
} from "../../lib/governanceApi";

const FIELD_CLASS =
  "rounded-sm border border-surface-border px-3 py-2 text-sm text-ink-900 outline-none transition-colors duration-150 focus:border-brand-green";
const LABEL_CLASS = "flex flex-col gap-1.5 text-sm font-medium text-ink-700";
const BUTTON_CLASS =
  "rounded-md bg-brand-green px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-brand-green-dark active:scale-[0.98] disabled:opacity-60 disabled:active:scale-100 transition-all duration-150";
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
  const [selectedRoleId, setSelectedRoleId] = useState<number | null>(null);
  const [selectedPermissionIds, setSelectedPermissionIds] = useState<number[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [showInviteForm, setShowInviteForm] = useState(false);
  const [invite, setInvite] = useState<StaffInvitePayload>(EMPTY_INVITE);

  const refresh = async () => {
    if (!accessToken) return;
    const [roleRes, permissionRes, staffRes] = await Promise.all([
      listRoles(accessToken),
      listPermissions(accessToken),
      listPlatformStaff(accessToken),
    ]);
    setRoles(roleRes.results);
    setPermissions(permissionRes);
    setStaff(staffRes.results);
    return roleRes.results;
  };

  useEffect(() => {
    if (!accessToken) return;
    void Promise.resolve().then(() =>
      refresh()
        .then((loadedRoles) => {
          const platformRoles = (loadedRoles ?? []).filter((r) => r.scope === "PLATFORM");
          if (platformRoles.length > 0 && selectedRoleId === null) {
            setSelectedRoleId(platformRoles[0].id);
            setSelectedPermissionIds(platformRoles[0].permissions);
          }
        })
        .catch((err) =>
          setError(err instanceof ApiError ? err.message : "Couldn't load roles and permissions."),
        )
        .finally(() => setIsLoading(false)),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accessToken]);

  const platformRoles = roles.filter((r) => r.scope === "PLATFORM");

  const selectRole = (role: Role) => {
    setSelectedRoleId(role.id);
    setSelectedPermissionIds(role.permissions);
  };

  const selectedRole = platformRoles.find((r) => r.id === selectedRoleId) ?? null;

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

  const saveRolePermissions = async () => {
    if (!accessToken || !selectedRole) return;
    setError(null);
    setBusy(true);
    try {
      await updateRole(accessToken, selectedRole.id, { permissions: selectedPermissionIds });
      const refreshed = await refresh();
      const updated = refreshed?.find((r) => r.id === selectedRole.id);
      if (updated) setSelectedPermissionIds(updated.permissions);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't save role permissions.");
    } finally {
      setBusy(false);
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

      {isLoading && platformRoles.length === 0 && <p className="text-sm text-ink-500">Loading…</p>}

      {!isLoading && platformRoles.length === 0 && (
        <div className="rounded-lg border border-surface-border bg-surface-card p-6 shadow-sm">
          <p className="text-sm text-ink-500">No platform roles have been configured yet.</p>
        </div>
      )}

      {platformRoles.length > 0 && (
        <div className="rounded-lg border border-surface-border bg-surface-card p-6 shadow-sm">
          <h2 className="mb-4 font-display text-base font-semibold text-ink-900">Roles</h2>

          <div className="flex flex-wrap gap-2">
            {platformRoles.map((role) => (
              <button
                key={role.id}
                type="button"
                onClick={() => selectRole(role)}
                className={`rounded-full px-4 py-1.5 text-sm font-semibold transition-colors ${
                  role.id === selectedRoleId
                    ? "bg-brand-green text-white"
                    : "border border-surface-border text-ink-700 hover:bg-surface-bg"
                }`}
              >
                {role.name}
                <span
                  className={`ml-1.5 text-xs ${
                    role.id === selectedRoleId ? "text-white/80" : "text-ink-500"
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

              <div className="overflow-x-auto rounded-lg border border-surface-border">
                <table className="w-full text-left text-sm">
                  <thead className="border-b border-surface-border bg-surface-bg text-xs font-semibold uppercase tracking-wide text-ink-500">
                    <tr>
                      <th className="px-4 py-3">Permission</th>
                      <th className="w-16 px-4 py-3 text-center">Granted</th>
                    </tr>
                  </thead>
                  <tbody>
                    {permissions.map((permission) => (
                      <tr
                        key={permission.id}
                        className="border-b border-surface-border last:border-0"
                      >
                        <td className="px-4 py-3">
                          <div className="font-medium text-ink-900">{permission.codename}</div>
                          {permission.description && (
                            <div className="text-xs text-ink-500">{permission.description}</div>
                          )}
                        </td>
                        <td className="px-4 py-3 text-center">
                          <input
                            type="checkbox"
                            className="h-4 w-4 accent-brand-green"
                            checked={selectedPermissionIds.includes(permission.id)}
                            onChange={() => togglePermission(permission.id)}
                          />
                        </td>
                      </tr>
                    ))}
                    {permissions.length === 0 && (
                      <tr>
                        <td colSpan={2} className="px-4 py-6 text-center text-ink-500">
                          No permissions defined.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>

              <div>
                <button
                  type="button"
                  disabled={busy || !permissionsDirty}
                  onClick={saveRolePermissions}
                  className={BUTTON_CLASS}
                >
                  Save Changes
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      <div className="overflow-x-auto rounded-lg border border-surface-border bg-surface-card shadow-sm">
        <div className="flex items-center justify-between px-6 pt-6">
          <h2 className="font-display text-base font-semibold text-ink-900">Platform Staff</h2>
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
                {platformRoles.map((role) => (
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
              <th className="px-6 py-3">Role(s)</th>
              <th className="px-6 py-3">Status</th>
              <th className="px-6 py-3">Last Login</th>
            </tr>
          </thead>
          <tbody>
            {staff.map((s) => (
              <tr key={s.id} className="border-b border-surface-border last:border-0">
                <td className="px-6 py-3 font-medium text-ink-900">
                  {s.first_name} {s.last_name}
                </td>
                <td className="px-6 py-3 text-ink-700">{s.email}</td>
                <td className="px-6 py-3 text-ink-700">{s.role_names.join(", ") || "—"}</td>
                <td className="px-6 py-3">
                  <span
                    className={`rounded-full px-2 py-0.5 text-xs font-semibold ${
                      s.is_active
                        ? "bg-brand-green-tint text-brand-green-dark"
                        : "bg-status-red-tint text-status-red"
                    }`}
                  >
                    {s.is_active ? "Active" : "Inactive"}
                  </span>
                </td>
                <td className="px-6 py-3 text-ink-700">
                  {s.last_login ? new Date(s.last_login).toLocaleString() : "Never"}
                </td>
              </tr>
            ))}
            {staff.length === 0 && (
              <tr>
                <td colSpan={5} className="px-6 py-6 text-center text-ink-500">
                  No platform staff yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
