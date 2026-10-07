import { useAuth } from "../auth/useAuth";
import { AppShell } from "./AppShell";
import { CLINICAL_NAV } from "./navConfig";
import { OrgBranchPill } from "./OrgBranchPill";
import { TopbarActions } from "./TopbarActions";
import { initialsAndLabel } from "./userDisplay";

// Topbar titles where the mockup's title differs from the nav label
// (docs/15-CLINICAL-WORKSPACE-V3.md §1.1).
const PAGE_TITLES: Record<string, string> = {
  "/clinical/registration": "Client registry",
  "/clinical/triage": "Triage & Queue",
  "/clinical/triage/*": "Triage encounter",
  "/clinical/psychiatry": "Psychiatry Workspace",
  "/clinical/clients/*": "Client Record",
  "/clinical/inpatient": "Inpatient Admissions",
  "/clinical/inpatient/ward": "Ward Board",
  "/clinical/psychotherapy/*": "Outpatient Care",
  "/clinical/documents": "Clinical Documents",
  "/clinical/documents/*": "Signed Triage Assessment",
  "/clinical/reports": "Reports & Analytics",
  "/clinical/profile": "My Profile",
  "/clinical/notifications": "Notifications",
  "/clinical/registry": "Client Registry",
  "/clinical/patient": "Client Workspace",
  "/clinical/triage-mse": "Triage & MSE",
  "/clinical/encounter": "Clinical Encounter",
  "/clinical/ipd": "Admissions & Ward Workflow",
  "/clinical/attachments": "Attachments",
};

/** docs/15-CLINICAL-WORKSPACE-V3.md §1.1 — mockups/citramac_clinical_workspace.html. */
export function ClinicalWorkspaceShell() {
  const { claims } = useAuth();
  const { initials, name } = initialsAndLabel(claims);

  return (
    <AppShell
      brandName="CITRAMAC"
      brandSub="HMIS v2.0"
      navGroups={CLINICAL_NAV}
      userInitials={initials}
      userName={name}
      userRole={claims?.role.replace(/_/g, " ") || "Clinician"}
      searchPlaceholder="Search clients..."
      profilePath="/clinical/profile"
      variant="brand"
      pageTitles={PAGE_TITLES}
      topbarRight={
        <TopbarActions
          pill={<OrgBranchPill />}
          notificationsPath="/clinical/notifications"
          tone="brand"
        />
      }
    />
  );
}
