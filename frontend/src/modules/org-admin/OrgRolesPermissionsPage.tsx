import { RolesWorkspace } from "../../components/RolesWorkspace";

/**
 * Org Admin → Roles & Permissions: the organisation's own roles. It starts with
 * its own copy of each standard role (renamable, permissions adjustable) and can
 * add custom ones; Org Admin and Auditor are built in and fixed. Who holds a role
 * at which branch is changed in Staff & MHP Team.
 */
export function OrgRolesPermissionsPage() {
  return (
    <div className="flex flex-col gap-6 animate-fade-in">
      <div>
        <div className="mb-1.5 text-[11px] font-bold uppercase tracking-wide text-brand-green">
          Org Admin · Governance
        </div>
        <h1 className="font-display text-2xl font-bold text-ink-900">Roles &amp; Permissions</h1>
        <p className="mt-1 text-sm text-ink-500">
          Your organisation&apos;s roles and what each one allows. Changes apply only to your
          organisation, from each holder&apos;s next action.
        </p>
      </div>
      <RolesWorkspace mode="organisation" />
    </div>
  );
}
