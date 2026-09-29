import { useAuth } from "../auth/useAuth";
import { AppShell } from "./AppShell";
import { SUPER_ADMIN_NAV } from "./navConfig";
import { PlatformStatusPill } from "./PlatformStatusPill";
import { TopbarActions } from "./TopbarActions";
import { initialsAndLabel } from "./userDisplay";

/** docs/03-DESIGN-SYSTEM.md §3.5 — mockups/citramac_SUPER-ADMIN.html. */
export function SuperAdminShell() {
  const { claims } = useAuth();
  const { initials, name } = initialsAndLabel(claims);

  return (
    <AppShell
      brandName="CITRAMAC"
      brandSub="Platform Console"
      navGroups={SUPER_ADMIN_NAV}
      userInitials={initials}
      userName={name}
      userRole="Super Admin"
      searchPlaceholder="Search organizations, branches, users…"
      profilePath="/super-admin/profile"
      topbarRight={
        <TopbarActions
          pill={<PlatformStatusPill />}
          notificationsPath="/super-admin/notifications"
        />
      }
    />
  );
}
