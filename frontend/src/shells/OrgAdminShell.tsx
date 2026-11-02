import { useAuth } from "../auth/useAuth";
import { AppShell } from "./AppShell";
import { AUDITOR_NAV, ORG_ADMIN_NAV } from "./navConfig";
import { OrgBranchPill } from "./OrgBranchPill";
import { TopbarActions } from "./TopbarActions";
import { initialsAndLabel } from "./userDisplay";

/** docs/03-DESIGN-SYSTEM.md §3.5 — mockups/citramac_ORG-admin.html. */
export function OrgAdminShell() {
  const { claims, profile } = useAuth();
  const { initials, name } = initialsAndLabel(claims);
  // An Auditor reaches this shell for the audit log only (roleRouting.ts).
  const isAuditor = claims?.role === "Auditor";
  const brandSub = isAuditor
    ? "Auditor"
    : `${profile?.organization_name ?? "Org"} Admin`;

  return (
    <AppShell
      brandName="CITRAMAC"
      brandSub={brandSub}
      navGroups={isAuditor ? AUDITOR_NAV : ORG_ADMIN_NAV}
      userInitials={initials}
      userName={name}
      userRole={isAuditor ? "Auditor" : "Org Admin"}
      searchPlaceholder="Search clients, staff, wards…"
      profilePath={isAuditor ? "/org-admin/audit-log" : "/org-admin/profile"}
      topbarRight={
        <TopbarActions pill={<OrgBranchPill />} notificationsPath="/org-admin/notifications" />
      }
    />
  );
}
