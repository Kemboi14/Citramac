import { useEffect, useMemo, useState } from "react";
import { Copy, Loader2, Plus, Search, Users } from "lucide-react";
import { useAuth } from "../auth/useAuth";
import { ApiError } from "../lib/apiClient";
import {
  createRole,
  listPermissions,
  listRoleMembers,
  listRoles,
  reactivateRole,
  retireRole,
  updateRole,
  type Permission,
  type Role,
  type RoleKind,
  type RoleMember,
} from "../lib/governanceApi";
import { Callout, StatusPill } from "../modules/care/shared/ui";
import { ConfirmDialog } from "./ConfirmDialog";
import { Drawer } from "./Drawer";
import { PermissionChangeDialog, PermissionMatrix } from "./PermissionMatrix";

const FIELD_CLASS =
  "w-full rounded-sm border border-surface-border bg-surface-card px-3 py-2 text-sm text-ink-900 outline-none transition-colors duration-150 focus:border-brand-green disabled:bg-surface-bg disabled:text-ink-500";
const LABEL_CLASS = "flex flex-col gap-1.5 text-sm font-medium text-ink-700";
const PRIMARY =
  "inline-flex items-center gap-2 rounded-md bg-brand-green px-4 py-2 text-sm font-semibold text-on-primary shadow-sm hover:bg-brand-green-dark active:scale-[0.98] disabled:opacity-60 disabled:active:scale-100 transition-all duration-150";
const SECONDARY =
  "inline-flex items-center gap-2 rounded-md border border-surface-border px-3 py-2 text-sm font-semibold text-ink-700 hover:bg-surface-bg active:scale-[0.98] disabled:opacity-60 disabled:active:scale-100 transition-all duration-150";

export type RolesWorkspaceMode = "organisation" | "platform";

const GROUPS: { kind: RoleKind | "retired"; title: string }[] = [
  { kind: "built_in", title: "Administration" },
  { kind: "standard", title: "Standard roles" },
  { kind: "custom", title: "Custom roles" },
  { kind: "retired", title: "Retired" },
];

const KIND_LABEL: Record<RoleKind, string> = {
  built_in: "Built in",
  standard: "Standard",
  custom: "Custom",
};

function groupOf(role: Role): RoleKind | "retired" {
  return role.is_active ? role.kind : "retired";
}

function errorText(err: unknown, fallback: string) {
  return err instanceof ApiError ? err.message : fallback;
}

/**
 * One side's roles — an organisation's (Org Admin) or the platform team's
 * (Super Admin); the two never appear together. A searchable list grouped
 * Administration / Standard / Custom / Retired, and for the chosen role: its
 * name and description, its permissions, and who holds it where. Nothing is
 * deleted: a role nobody holds is retired, and can be reactivated.
 */
export function RolesWorkspace({
  mode,
  onRolesChange,
}: {
  mode: RolesWorkspaceMode;
  onRolesChange?: (roles: Role[]) => void;
}) {
  const { accessToken } = useAuth();
  const [roles, setRoles] = useState<Role[]>([]);
  const [permissions, setPermissions] = useState<Permission[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [showRetired, setShowRetired] = useState(false);
  const [creating, setCreating] = useState<{ copyFrom: number | null } | null>(null);

  const holderWord = mode === "platform" ? "platform-team member" : "staff member";

  const applyRoles = (next: Role[]) => {
    setRoles(next);
    onRolesChange?.(next);
  };

  useEffect(() => {
    if (!accessToken) return;
    void Promise.resolve().then(() =>
      Promise.all([
        listRoles(accessToken),
        listPermissions(accessToken, mode === "platform" ? "PLATFORM" : "ORG"),
      ])
        .then(([roleRows, permissionRows]) => {
          setRoles(roleRows);
          onRolesChange?.(roleRows);
          setPermissions(permissionRows);
          const first =
            roleRows.find((r) => r.is_active && r.kind !== "built_in") ??
            roleRows.find((r) => r.is_active) ??
            roleRows[0];
          setSelectedId(first?.id ?? null);
        })
        .catch((err) => setLoadError(errorText(err, "Couldn't load roles and permissions.")))
        .finally(() => setLoading(false)),
    );
    // onRolesChange is a parent callback; reloading on its identity would loop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accessToken, mode]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return roles.filter(
      (r) => !q || r.name.toLowerCase().includes(q) || r.description.toLowerCase().includes(q),
    );
  }, [roles, query]);

  const selected = roles.find((r) => r.id === selectedId) ?? null;

  const replaceRole = (updated: Role) =>
    applyRoles(roles.map((r) => (r.id === updated.id ? updated : r)));

  if (loading) return <p className="text-sm text-ink-500">Loading…</p>;
  if (loadError) return <Callout tone="danger">{loadError}</Callout>;

  return (
    <div className="grid gap-5 lg:grid-cols-[300px_minmax(0,1fr)]">
      <section className="flex flex-col gap-3 self-start rounded-lg border border-surface-border bg-surface-card p-4 shadow-sm">
        <div className="flex items-center justify-between gap-2">
          <h2 className="font-display text-base font-semibold text-ink-900">
            Roles <span className="text-sm font-normal text-ink-500">({roles.length})</span>
          </h2>
          <button type="button" className={PRIMARY} onClick={() => setCreating({ copyFrom: null })}>
            <Plus size={15} />
            New role
          </button>
        </div>
        <label className="relative">
          <span className="sr-only">Search roles</span>
          <Search
            size={15}
            className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-500"
          />
          <input
            className={`${FIELD_CLASS} pl-8`}
            placeholder="Search roles"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </label>
        <nav aria-label="Roles" className="flex max-h-[65vh] flex-col gap-3 overflow-y-auto">
          {GROUPS.map(({ kind, title }) => {
            const items = filtered.filter((r) => groupOf(r) === kind);
            if (items.length === 0) return null;
            const collapsed = kind === "retired" && !showRetired && !query.trim();
            return (
              <div key={kind}>
                <div className="mb-1 flex items-center justify-between px-1 text-[11px] font-bold uppercase tracking-wide text-ink-500">
                  <span>
                    {title} · {items.length}
                  </span>
                  {kind === "retired" && !query.trim() && (
                    <button
                      type="button"
                      className="font-semibold normal-case tracking-normal text-brand-green hover:underline"
                      onClick={() => setShowRetired((v) => !v)}
                    >
                      {showRetired ? "Hide" : "Show"}
                    </button>
                  )}
                </div>
                {!collapsed && (
                  <ul className="flex flex-col">
                    {items.map((r) => (
                      <li key={r.id}>
                        <button
                          type="button"
                          aria-current={r.id === selectedId ? "true" : undefined}
                          onClick={() => setSelectedId(r.id)}
                          className={`flex w-full items-center justify-between gap-2 rounded-md px-2.5 py-2 text-left text-sm transition-colors ${
                            r.id === selectedId
                              ? "bg-brand-green-tint font-semibold text-ink-900"
                              : "text-ink-700 hover:bg-surface-bg"
                          }`}
                        >
                          <span className="min-w-0 truncate">{r.name}</span>
                          <span
                            className="flex flex-none items-center gap-1 text-xs text-ink-500"
                            title={`${r.user_count} ${r.user_count === 1 ? "person holds" : "people hold"} this role`}
                          >
                            <Users size={12} aria-hidden="true" />
                            {r.user_count}
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            );
          })}
          {filtered.length === 0 && (
            <p className="px-1 text-sm text-ink-500">No role matches “{query.trim()}”.</p>
          )}
        </nav>
      </section>

      {selected ? (
        <RoleDetail
          key={selected.id}
          role={selected}
          permissions={permissions}
          holderWord={holderWord}
          mode={mode}
          onSaved={replaceRole}
          onCopy={() => setCreating({ copyFrom: selected.id })}
        />
      ) : (
        <section className="rounded-lg border border-surface-border bg-surface-card p-6 text-sm text-ink-500 shadow-sm">
          Choose a role to see what it allows and who holds it.
        </section>
      )}

      <NewRoleDrawer
        open={creating !== null}
        copyFrom={creating?.copyFrom ?? null}
        roles={roles}
        mode={mode}
        onClose={() => setCreating(null)}
        onCreated={(role) => {
          applyRoles([...roles, role].sort((a, b) => a.name.localeCompare(b.name)));
          setSelectedId(role.id);
          setCreating(null);
        }}
      />
    </div>
  );
}

function RoleDetail({
  role,
  permissions,
  holderWord,
  mode,
  onSaved,
  onCopy,
}: {
  role: Role;
  permissions: Permission[];
  holderWord: string;
  mode: RolesWorkspaceMode;
  onSaved: (role: Role) => void;
  onCopy: () => void;
}) {
  const { accessToken } = useAuth();
  const [name, setName] = useState(role.name);
  const [description, setDescription] = useState(role.description);
  const [draft, setDraft] = useState<Set<number>>(new Set(role.permissions));
  const [members, setMembers] = useState<RoleMember[] | null>(null);
  const [membersError, setMembersError] = useState<string | null>(null);
  const [confirmSave, setConfirmSave] = useState(false);
  const [confirmRetire, setConfirmRetire] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!accessToken) return;
    void Promise.resolve().then(() =>
      listRoleMembers(accessToken, role.id)
        .then(setMembers)
        .catch((err) => setMembersError(errorText(err, "Couldn't load who holds this role."))),
    );
  }, [accessToken, role.id, role.user_count]);

  const locked = role.is_locked;
  const editable = !locked && role.is_active;
  const saved = new Set(role.permissions);
  const permissionsDirty = saved.size !== draft.size || [...draft].some((id) => !saved.has(id));
  const detailsDirty = name.trim() !== role.name || description.trim() !== role.description;
  const dirty = editable && (permissionsDirty || detailsDirty);

  const toggle = (id: number) =>
    setDraft((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const save = async () => {
    if (!accessToken) return;
    setBusy(true);
    setError(null);
    try {
      const updated = await updateRole(accessToken, role.id, {
        ...(detailsDirty ? { name: name.trim(), description: description.trim() } : {}),
        ...(permissionsDirty ? { permissions: [...draft] } : {}),
      });
      onSaved(updated);
      setConfirmSave(false);
    } catch (err) {
      setError(errorText(err, "Couldn't save this role."));
    } finally {
      setBusy(false);
    }
  };

  const setActive = async (active: boolean) => {
    if (!accessToken) return;
    setBusy(true);
    setError(null);
    try {
      onSaved(
        active
          ? await reactivateRole(accessToken, role.id)
          : await retireRole(accessToken, role.id),
      );
      setConfirmRetire(false);
    } catch (err) {
      setError(
        errorText(err, active ? "Couldn't reactivate this role." : "Couldn't retire this role."),
      );
    } finally {
      setBusy(false);
    }
  };

  const granted = permissions.filter((p) => saved.has(p.id)).length;

  return (
    <div className="flex min-w-0 flex-col gap-5">
      <section className="rounded-lg border border-surface-border bg-surface-card p-5 shadow-sm">
        <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="font-display text-lg font-semibold text-ink-900">{role.name}</h2>
              <StatusPill tone={role.kind === "built_in" ? "info" : "neutral"}>
                {KIND_LABEL[role.kind]}
              </StatusPill>
              {!role.is_active && <StatusPill tone="warning">Retired</StatusPill>}
            </div>
            <p className="mt-1 text-sm text-ink-500">
              {role.user_count} {role.user_count === 1 ? holderWord : `${holderWord}s`} ·{" "}
              {locked ? "access fixed" : `${granted} of ${permissions.length} permissions`}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {!locked && (
              <button type="button" className={SECONDARY} onClick={onCopy}>
                <Copy size={14} />
                Copy role
              </button>
            )}
            {!locked &&
              (role.is_active ? (
                <button
                  type="button"
                  className={SECONDARY}
                  disabled={busy}
                  onClick={() => {
                    setError(null);
                    setConfirmRetire(true);
                  }}
                >
                  Retire
                </button>
              ) : (
                <button
                  type="button"
                  className={SECONDARY}
                  disabled={busy}
                  onClick={() => void setActive(true)}
                >
                  Reactivate
                </button>
              ))}
          </div>
        </div>

        {locked && (
          <Callout tone="info" label={null} className="mb-4">
            {mode === "platform"
              ? "Super Admin comes with a Super Admin account and is never given as a role. Its access is fixed."
              : `${role.name} is a built-in administrator role. Its name and access are fixed, so the organisation can never lock itself out.`}
          </Callout>
        )}
        {!role.is_active && (
          <Callout tone="warning" label={null} className="mb-4">
            Nobody can be given this role. Reactivate it to use it again.
          </Callout>
        )}
        {mode === "platform" && !locked && (
          <Callout tone="info" label="Not yet in use" className="mb-4">
            Only Super Admin can open the platform console today. These permissions record what this
            role is for and take effect once console access for platform-team roles is switched on.
          </Callout>
        )}

        <div className="grid gap-4 sm:grid-cols-2">
          <label className={LABEL_CLASS}>
            Name
            <input
              className={FIELD_CLASS}
              value={name}
              maxLength={100}
              disabled={!editable}
              onChange={(e) => setName(e.target.value)}
            />
          </label>
          <label className={LABEL_CLASS}>
            Description
            <input
              className={FIELD_CLASS}
              value={description}
              maxLength={255}
              disabled={!editable}
              placeholder="What this role is for"
              onChange={(e) => setDescription(e.target.value)}
            />
          </label>
        </div>
      </section>

      <section className="rounded-lg border border-surface-border bg-surface-card p-5 shadow-sm">
        <h3 className="mb-3 font-display text-base font-semibold text-ink-900">Permissions</h3>
        {locked ? (
          <p className="text-sm text-ink-700">
            {mode === "platform"
              ? "Everything in the platform console."
              : role.system_key === "org_admin"
                ? "Facility administration: staff and their roles, branches and departments, settings, tariffs, retention, consent wording and the audit trail, at every branch."
                : "Reads the organisation's audit trail and signs off compliance requests. Changes no clinical record."}
          </p>
        ) : (
          <PermissionMatrix
            permissions={permissions}
            selected={draft}
            disabled={!editable}
            onToggle={toggle}
          />
        )}
        {editable && (
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <button
              type="button"
              className={PRIMARY}
              disabled={!dirty || busy}
              onClick={() => {
                setError(null);
                if (permissionsDirty) setConfirmSave(true);
                else void save();
              }}
            >
              {busy && !confirmSave ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              Save changes
            </button>
            {dirty && (
              <button
                type="button"
                className={SECONDARY}
                onClick={() => {
                  setName(role.name);
                  setDescription(role.description);
                  setDraft(new Set(role.permissions));
                }}
              >
                Discard
              </button>
            )}
            {error && !confirmSave && !confirmRetire && (
              <span role="alert" className="text-sm text-status-red">
                {error}
              </span>
            )}
          </div>
        )}
      </section>

      <section className="rounded-lg border border-surface-border bg-surface-card p-5 shadow-sm">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h3 className="font-display text-base font-semibold text-ink-900">Who holds this role</h3>
          {mode === "organisation" && (
            <span className="text-xs text-ink-500">
              Give or take away roles in Staff &amp; MHP Team, per branch.
            </span>
          )}
        </div>
        {membersError && <Callout tone="danger">{membersError}</Callout>}
        {!membersError && members === null && <p className="text-sm text-ink-500">Loading…</p>}
        {members && members.length === 0 && (
          <p className="text-sm text-ink-500">Nobody holds this role.</p>
        )}
        {members && members.length > 0 && (
          <div className="max-h-80 overflow-auto rounded-md border border-surface-border">
            <table className="w-full text-left text-sm">
              <thead className="sticky top-0 border-b border-surface-border bg-surface-bg text-xs font-semibold uppercase tracking-wide text-ink-500">
                <tr>
                  <th className="px-4 py-2">Name</th>
                  <th className="px-4 py-2">Email</th>
                  <th className="px-4 py-2">{mode === "platform" ? "Team" : "Where"}</th>
                  <th className="px-4 py-2">Status</th>
                </tr>
              </thead>
              <tbody>
                {members.map((m) => (
                  <tr key={m.id} className="border-b border-surface-border last:border-0">
                    <td className="px-4 py-2 font-medium text-ink-900">
                      {`${m.first_name} ${m.last_name}`.trim() || m.email}
                    </td>
                    <td className="px-4 py-2 text-ink-700">{m.email}</td>
                    <td className="px-4 py-2 text-ink-700">{m.branches.join(", ")}</td>
                    <td className="px-4 py-2">
                      <StatusPill tone={m.is_active ? "success" : "neutral"}>
                        {m.is_active ? "Active" : "Not active"}
                      </StatusPill>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <PermissionChangeDialog
        open={confirmSave}
        roleName={role.name}
        userCount={role.user_count}
        permissions={permissions}
        before={saved}
        after={draft}
        busy={busy}
        error={error}
        onConfirm={() => void save()}
        onCancel={() => setConfirmSave(false)}
      />
      <ConfirmDialog
        open={confirmRetire}
        title={`Retire ${role.name}?`}
        confirmLabel="Yes, retire role"
        busyLabel="Retiring…"
        tone="danger"
        busy={busy}
        error={error}
        onConfirm={() => void setActive(false)}
        onCancel={() => setConfirmRetire(false)}
      >
        <p className="text-sm text-ink-700">
          {role.user_count > 0
            ? `${role.user_count} ${role.user_count === 1 ? "person holds" : "people hold"} this role. Give them another role first; a role can only be retired once nobody holds it.`
            : "Nobody will be able to be given this role. It stays on record and can be reactivated."}
        </p>
      </ConfirmDialog>
    </div>
  );
}

function NewRoleDrawer({
  open,
  copyFrom,
  roles,
  mode,
  onClose,
  onCreated,
}: {
  open: boolean;
  copyFrom: number | null;
  roles: Role[];
  mode: RolesWorkspaceMode;
  onClose: () => void;
  onCreated: (role: Role) => void;
}) {
  const { accessToken } = useAuth();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [source, setSource] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const formId = "new-role-form";
  const copyable = roles.filter((r) => !r.is_locked && r.is_active);

  useEffect(() => {
    if (!open) return;
    void Promise.resolve().then(() => {
      const from = roles.find((r) => r.id === copyFrom);
      setName(from ? `${from.name} (copy)` : "");
      setDescription(from?.description ?? "");
      setSource(from ? String(from.id) : "");
      setError(null);
    });
  }, [open, copyFrom, roles]);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!accessToken) return;
    setBusy(true);
    setError(null);
    try {
      const role = await createRole(accessToken, {
        name: name.trim(),
        description: description.trim() || undefined,
        ...(source ? { copy_from: Number(source) } : { permissions: [] }),
      });
      onCreated(role);
    } catch (err) {
      setError(errorText(err, "Couldn't create this role."));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Drawer
      open={open}
      title="New role"
      subtitle={mode === "platform" ? "A platform-team role" : "A role for your organisation"}
      onClose={onClose}
      footer={
        <div className="flex justify-end gap-2">
          <button type="button" className={SECONDARY} onClick={onClose}>
            Cancel
          </button>
          <button type="submit" form={formId} className={PRIMARY} disabled={busy || !name.trim()}>
            {busy && <Loader2 className="h-4 w-4 animate-spin" />}
            {busy ? "Creating…" : "Create role"}
          </button>
        </div>
      }
    >
      <form id={formId} onSubmit={submit} className="flex flex-col gap-4">
        <label className={LABEL_CLASS}>
          Name
          <input
            className={FIELD_CLASS}
            value={name}
            maxLength={100}
            required
            onChange={(e) => setName(e.target.value)}
          />
        </label>
        <label className={LABEL_CLASS}>
          Description
          <input
            className={FIELD_CLASS}
            value={description}
            maxLength={255}
            placeholder="What this role is for"
            onChange={(e) => setDescription(e.target.value)}
          />
        </label>
        <label className={LABEL_CLASS}>
          Start from
          <select
            className={FIELD_CLASS}
            value={source}
            onChange={(e) => setSource(e.target.value)}
          >
            <option value="">No permissions — choose them after</option>
            {copyable.map((r) => (
              <option key={r.id} value={r.id}>
                A copy of {r.name}
              </option>
            ))}
          </select>
        </label>
        {error && (
          <Callout tone="danger" role="alert">
            {error}
          </Callout>
        )}
      </form>
    </Drawer>
  );
}
