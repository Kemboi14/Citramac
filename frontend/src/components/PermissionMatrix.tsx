import type { Permission } from "../lib/governanceApi";
import { ConfirmDialog } from "./ConfirmDialog";

/**
 * The permission catalogue (backend apps/accounts/catalogue.py) grouped by area:
 * each permission's plain-language name, what it allows, and its code. Used by
 * both Roles & Permissions screens.
 */
export function PermissionMatrix({
  permissions,
  selected,
  disabled,
  onToggle,
}: {
  permissions: Permission[];
  selected: Set<number>;
  disabled?: boolean;
  onToggle: (id: number) => void;
}) {
  const groups = new Map<string, Permission[]>();
  for (const p of permissions) {
    const key = p.module_label || "Other";
    groups.set(key, [...(groups.get(key) ?? []), p]);
  }
  if (permissions.length === 0) {
    return <p className="text-sm text-ink-500">No permissions apply to this role.</p>;
  }
  return (
    <div className="flex flex-col gap-4">
      {[...groups.entries()].map(([module, items]) => (
        <fieldset key={module} className="rounded-md border border-surface-border">
          <legend className="ml-3 px-1 text-xs font-bold uppercase tracking-wide text-ink-500">
            {module}
          </legend>
          <ul className="divide-y divide-surface-border">
            {items.map((p) => (
              <li key={p.id}>
                <label
                  className={`flex items-start gap-3 px-4 py-3 ${disabled ? "" : "cursor-pointer hover:bg-surface-bg"}`}
                >
                  <input
                    type="checkbox"
                    className="mt-1 h-4 w-4 accent-brand-green"
                    checked={selected.has(p.id)}
                    disabled={disabled}
                    onChange={() => onToggle(p.id)}
                  />
                  <span className="min-w-0">
                    <span className="block text-sm font-semibold text-ink-900">
                      {p.label || p.codename}
                    </span>
                    {p.description && (
                      <span className="block text-[13px] text-ink-700">{p.description}</span>
                    )}
                    <span className="mt-0.5 block font-mono text-[11px] text-ink-500">
                      {p.codename}
                    </span>
                  </span>
                </label>
              </li>
            ))}
          </ul>
        </fieldset>
      ))}
    </div>
  );
}

/** "Are you sure?" before a role's permissions change: lists exactly what is
 * given and taken away. */
export function PermissionChangeDialog({
  open,
  roleName,
  userCount,
  permissions,
  before,
  after,
  busy,
  error,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  roleName: string;
  userCount: number | null;
  permissions: Permission[];
  before: Set<number>;
  after: Set<number>;
  busy: boolean;
  error: string | null;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const name = (id: number) => {
    const p = permissions.find((x) => x.id === id);
    return p ? p.label || p.codename : `Permission ${id}`;
  };
  const added = [...after].filter((id) => !before.has(id)).map(name);
  const removed = [...before].filter((id) => !after.has(id)).map(name);
  return (
    <ConfirmDialog
      open={open}
      title={`Save changes to ${roleName}?`}
      confirmLabel="Yes, save changes"
      busyLabel="Saving…"
      tone={removed.length ? "danger" : "primary"}
      busy={busy}
      error={error}
      onConfirm={onConfirm}
      onCancel={onCancel}
    >
      <div className="flex flex-col gap-3 text-sm text-ink-700">
        <p>
          This changes what{" "}
          {userCount === null
            ? "everyone with this role"
            : `the ${userCount} ${userCount === 1 ? "person" : "people"} with this role`}{" "}
          can do, from their next action.
        </p>
        {added.length > 0 && (
          <div>
            <div className="font-semibold text-ink-900">Will be given</div>
            <ul className="ml-5 list-disc">
              {added.map((a) => (
                <li key={a}>{a}</li>
              ))}
            </ul>
          </div>
        )}
        {removed.length > 0 && (
          <div>
            <div className="font-semibold text-status-red">Will be taken away</div>
            <ul className="ml-5 list-disc">
              {removed.map((r) => (
                <li key={r}>{r}</li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </ConfirmDialog>
  );
}
