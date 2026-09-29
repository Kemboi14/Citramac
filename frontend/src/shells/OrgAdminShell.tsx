import { useAuth } from "../auth/useAuth";
import { AppShell } from "./AppShell";
import { ORG_ADMIN_NAV } from "./navConfig";
import { OrgBranchPill } from "./OrgBranchPill";
import { TopbarActions } from "./TopbarActions";
import { initialsAndLabel } from "./userDisplay";

/** docs/03-DESIGN-SYSTEM.md §3.5 — mockups/citramac_ORG-admin.html. */
export function OrgAdminShell() {
  const { claims } = useAuth();
  const { initials, name } = initialsAndLabel(claims);

  return (
    <AppShell
      brandName="CITRAMAC"
      brandSub="Org Admin"
      navGroups={ORG_ADMIN_NAV}
      userInitials={initials}
      userName={name}
      userRole="Org Admin"
      searchPlaceholder="Search clients, staff, wards…"
      profilePath="/org-admin/profile"
      topbarRight={
        <TopbarActions pill={<OrgBranchPill />} notificationsPath="/org-admin/notifications" />
      }
    />
  );
}
