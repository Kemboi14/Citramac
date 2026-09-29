import { useAuth } from "../auth/useAuth";
import { AppShell } from "./AppShell";
import { CLINICAL_NAV } from "./navConfig";
import { OrgBranchPill } from "./OrgBranchPill";
import { TopbarActions } from "./TopbarActions";
import { initialsAndLabel } from "./userDisplay";

/** docs/03-DESIGN-SYSTEM.md §3.5 — mockups/citramac_clinical_workspace.html. */
export function ClinicalWorkspaceShell() {
  const { claims } = useAuth();
  const { initials, name } = initialsAndLabel(claims);

  return (
    <AppShell
      brandName="CITRAMAC"
      brandSub="Clinical Workspace"
      navGroups={CLINICAL_NAV}
      userInitials={initials}
      userName={name}
      userRole={claims?.role.replace(/_/g, " ") || "Clinician"}
      searchPlaceholder="Search clients by name or UHID…"
      profilePath="/clinical/profile"
      topbarRight={
        <TopbarActions pill={<OrgBranchPill />} notificationsPath="/clinical/notifications" />
      }
    />
  );
}
