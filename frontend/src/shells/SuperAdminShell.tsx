import { useAuth } from "../auth/useAuth";
import { AppShell } from "./AppShell";
import { SUPER_ADMIN_NAV } from "./navConfig";
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
      topbarRight={
        <TopbarActions
          pill={
            <div className="flex items-center gap-1.5 rounded-full bg-brand-green-tint px-3 py-1.5 text-[11.5px] font-semibold text-brand-green-dark">
              <span className="h-1.5 w-1.5 rounded-full bg-brand-green" />
              All Systems Operational
            </div>
          }
        />
      }
    />
  );
}
