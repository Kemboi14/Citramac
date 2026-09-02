import { useEffect, useState } from "react";
import { Plus, ShieldCheck } from "lucide-react";
import { useAuth } from "../../auth/useAuth";
import { ApiError } from "../../lib/apiClient";
import {
  createRole,
  listPermissions,
  listRoles,
  listStaff,
  updateRole,
  updateStaff,
  type Permission,
  type Role,
  type Staff,
} from "../../lib/governanceApi";

const FIELD_CLASS =
  "rounded-sm border border-surface-border px-3 py-2 text-sm text-ink-900 outline-none transition-colors duration-150 focus:border-brand-green";
const LABEL_CLASS = "flex flex-col gap-1.5 text-sm font-medium text-ink-700";
const BUTTON_CLASS =
  "rounded-md bg-brand-green px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-brand-green-dark active:scale-[0.98] disabled:opacity-60 disabled:active:scale-100 transition-all duration-150";
const CARD_CLASS = "rounded-lg border border-surface-border bg-surface-card p-6 shadow-sm";

/**
 * Org Admin's branch-level RBAC console — defines what each staff role can
 * see/do, and which staff are assigned to which role.
 * citramac_ORG-admin.html "Roles & Permissions".
 */
export function OrgRolesPermissionsPage() {
  const { accessToken } = useAuth();
  const [roles, setRoles] = useState<Role[]>([]);
  const [permissions, setPermissions] = useState<Permission[]>([]);
  const [staff, setStaff] = useState<Staff[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [selectedRoleId, setSelectedRoleId] = useState<number | null>(null);
  const [draftPermissionIds, setDraftPermissionIds] = useState<Set<number>>(new Set());
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const [showNewRoleForm, setShowNewRoleForm] = useState(false);
  const [newRoleName, setNewRoleName] = useState("");
  const [newRoleDescription, setNewRoleDescription] = useState("");
  const [newRoleError, setNewRoleError] = useState<string | null>(null);
  const [creatingRole, setCreatingRole] = useState(false);

  const [staffRoleBusyId, setStaffRoleBusyId] = useState<string | null>(null);
  const [staffRoleError, setStaffRoleError] = useState<string | null>(null);

  useEffect(() => {
    if (!accessToken) return;
    void Promise.resolve().then(() => {
      setError(null);
      return Promise.all([
        listRoles(accessToken),
        listPermissions(accessToken),
        listStaff(accessToken),
      ])
        .then(([roleRes, permissionRes, staffRes]) => {
          setRoles(roleRes.results);
          setPermissions(permissionRes);
          setStaff(staffRes.results);
          if (roleRes.results.length > 0) {
            setSelectedRoleId(roleRes.results[0].id);
          }
        })
        .catch((err) =>
          setError(err instanceof ApiError ? err.message : "Couldn't load roles & permissions."),
        )
        .finally(() => setLoading(false));
    });
  }, [accessToken]);

  const selectedRole = roles.find((r) => r.id === selectedRoleId) ?? null;
  const editable = selectedRole ? selectedRole.organization !== null : false;

  // Resets the local draft when the selected role changes — a same-component
  // local-state reset, not synchronizing with an external system, so the
  // "don't setState synchronously in an effect" rule doesn't fit here.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSaveError(null);
    setDraftPermissionIds(new Set(selectedRole?.permissions ?? []));
  }, [selectedRoleId, selectedRole]);

  const togglePermission = (id: number) => {
    if (!editable) return;
    setDraftPermissionIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const saveRolePermissions = async () => {
    if (!accessToken || !selectedRole) return;
    setSaving(true);
    setSaveError(null);
    try {
      const updated = await updateRole(accessToken, selectedRole.id, {
        permissions: Array.from(draftPermissionIds),
      });
      setRoles((prev) => prev.map((r) => (r.id === updated.id ? updated : r)));
    } catch (err) {
      setSaveError(err instanceof ApiError ? err.message : "Couldn't save permission changes.");
    } finally {
      setSaving(false);
    }
  };

  const submitNewRole = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!accessToken || !newRoleName.trim()) return;
    setCreatingRole(true);
    setNewRoleError(null);
    try {
      const role = await createRole(accessToken, {
        name: newRoleName.trim(),
        description: newRoleDescription.trim() || undefined,
        permissions: [],
      });
      const res = await listRoles(accessToken);
      setRoles(res.results);
      setSelectedRoleId(role.id);
      setShowNewRoleForm(false);
      setNewRoleName("");
      setNewRoleDescription("");
    } catch (err) {
      setNewRoleError(err instanceof ApiError ? err.message : "Couldn't create this role.");
    } finally {
      setCreatingRole(false);
    }
  };

  const reassignStaffRole = async (staffId: string, roleId: string) => {
    if (!accessToken || !roleId) return;
    setStaffRoleBusyId(staffId);
    setStaffRoleError(null);
    try {
      const updated = await updateStaff(accessToken, staffId, { roles: [Number(roleId)] });
      setStaff((prev) => prev.map((s) => (s.id === staffId ? updated : s)));
    } catch (err) {
      setStaffRoleError(err instanceof ApiError ? err.message : "Couldn't reassign this role.");
    } finally {
      setStaffRoleBusyId(null);
    }
  };

  return (
    <div className="flex flex-col gap-6">
      <div>
        <div className="mb-1.5 text-[11px] font-bold uppercase tracking-wide text-brand-green">
          Org Admin · Governance
        </div>
        <h1 className="font-display text-2xl font-bold text-ink-900">Roles & Permissions</h1>
      </div>

      {loading && <p className="text-sm text-ink-500">Loading…</p>}

      {error && (
        <p className="rounded-sm bg-status-red-tint px-3 py-2 text-sm text-status-red">{error}</p>
      )}

      {!loading && (
        <>
          <div className={CARD_CLASS}>
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
              <h2 className="font-display text-base font-semibold text-ink-900">Roles</h2>
              <button
                type="button"
                className={`${BUTTON_CLASS} flex items-center gap-2`}
                onClick={() => setShowNewRoleForm((v) => !v)}
              >
                <Plus size={16} />
                New Role
              </button>
            </div>

            {showNewRoleForm && (
              <form
                onSubmit={submitNewRole}
                className="mb-4 rounded-md border border-surface-border bg-surface-bg p-4"
              >
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <label className={LABEL_CLASS}>
                    Name
                    <input
                      className={FIELD_CLASS}
                      value={newRoleName}
                      onChange={(e) => setNewRoleName(e.target.value)}
                      required
                    />
                  </label>
                  <label className={LABEL_CLASS}>
                    Description
                    <input
                      className={FIELD_CLASS}
                      value={newRoleDescription}
                      onChange={(e) => setNewRoleDescription(e.target.value)}
                    />
                  </label>
                </div>
                {newRoleError && (
                  <p className="mt-3 rounded-sm bg-status-red-tint px-3 py-2 text-sm text-status-red">
                    {newRoleError}
                  </p>
                )}
                <div className="mt-3 flex gap-3">
                  <button type="submit" disabled={creatingRole} className={BUTTON_CLASS}>
                    Create Role
                  </button>
                  <button
                    type="button"
                    className="rounded-md border border-surface-border px-4 py-2 text-sm font-semibold text-ink-700 hover:bg-surface-card"
                    onClick={() => {
                      setShowNewRoleForm(false);
                      setNewRoleError(null);
                    }}
                  >
                    Cancel
                  </button>
                </div>
              </form>
            )}

            <div className="flex flex-wrap gap-2">
              {roles.map((r) => (
                <button
                  key={r.id}
                  type="button"
                  onClick={() => setSelectedRoleId(r.id)}
                  className={`rounded-md px-3 py-1.5 text-sm font-semibold ${
                    r.id === selectedRoleId
                      ? "bg-brand-green text-white"
                      : "bg-surface-bg text-ink-700 hover:bg-brand-green-tint"
                  }`}
                >
                  {r.name}
                </button>
              ))}
              {roles.length === 0 && <p className="text-sm text-ink-500">No roles yet.</p>}
            </div>

            {selectedRole && (
              <div className="mt-4 flex flex-col gap-4">
                {selectedRole.description && (
                  <div className="rounded-md border border-surface-border bg-brand-green-tint-2 p-3 text-sm text-ink-700">
                    {selectedRole.description}
                  </div>
                )}

                {!editable && (
                  <p className="text-xs text-ink-500">
                    This is a shared platform role template. It can&apos;t be edited here — create a
                    custom role for your organization instead.
                  </p>
                )}

                <div className="overflow-x-auto rounded-md border border-surface-border">
                  <table className="w-full text-left text-sm">
                    <thead className="border-b border-surface-border bg-surface-bg text-xs font-semibold uppercase tracking-wide text-ink-500">
                      <tr>
                        <th className="px-4 py-2 w-10"></th>
                        <th className="px-4 py-2">Permission</th>
                        <th className="px-4 py-2">Description</th>
                      </tr>
                    </thead>
                    <tbody>
                      {permissions.map((p) => (
                        <tr key={p.id} className="border-b border-surface-border last:border-0">
                          <td className="px-4 py-2">
                            <input
                              type="checkbox"
                              checked={draftPermissionIds.has(p.id)}
                              disabled={!editable}
                              onChange={() => togglePermission(p.id)}
                            />
                          </td>
                          <td className="px-4 py-2 font-mono text-xs text-ink-900">{p.codename}</td>
                          <td className="px-4 py-2 text-ink-700">{p.description}</td>
                        </tr>
                      ))}
                      {permissions.length === 0 && (
                        <tr>
                          <td colSpan={3} className="px-4 py-6 text-center text-ink-500">
                            No permissions found.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>

                {saveError && (
                  <p className="rounded-sm bg-status-red-tint px-3 py-2 text-sm text-status-red">
                    {saveError}
                  </p>
                )}

                {editable && (
                  <div>
                    <button
                      type="button"
                      disabled={saving}
                      onClick={saveRolePermissions}
                      className={BUTTON_CLASS}
                    >
                      Save Changes
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>

          <div className={CARD_CLASS}>
            <h2 className="mb-4 flex items-center gap-2 font-display text-base font-semibold text-ink-900">
              <ShieldCheck size={18} className="text-brand-green" />
              Assigned Users
            </h2>

            {staffRoleError && (
              <p className="mb-3 rounded-sm bg-status-red-tint px-3 py-2 text-sm text-status-red">
                {staffRoleError}
              </p>
            )}

            <div className="overflow-x-auto rounded-md border border-surface-border">
              <table className="w-full text-left text-sm">
                <thead className="border-b border-surface-border bg-surface-bg text-xs font-semibold uppercase tracking-wide text-ink-500">
                  <tr>
                    <th className="px-4 py-2">Staff Member</th>
                    <th className="px-4 py-2">Role</th>
                  </tr>
                </thead>
                <tbody>
                  {staff.map((s) => (
                    <tr key={s.id} className="border-b border-surface-border last:border-0">
                      <td className="px-4 py-2 font-medium text-ink-900">
                        {s.first_name} {s.last_name}
                      </td>
                      <td className="px-4 py-2">
                        <select
                          className={FIELD_CLASS}
                          value={s.roles[0] ?? ""}
                          disabled={staffRoleBusyId === s.id}
                          onChange={(e) => reassignStaffRole(s.id, e.target.value)}
                        >
                          <option value="">No role</option>
                          {roles.map((r) => (
                            <option key={r.id} value={r.id}>
                              {r.name}
                            </option>
                          ))}
                        </select>
                      </td>
                    </tr>
                  ))}
                  {staff.length === 0 && (
                    <tr>
                      <td colSpan={2} className="px-4 py-6 text-center text-ink-500">
                        No staff members yet.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
