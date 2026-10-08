import { useAuth } from "../auth/useAuth";
import { AppShell } from "./AppShell";
import { CLINICAL_NAV } from "./navConfig";
import { GlobalClientSearch } from "./GlobalClientSearch";
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
  "/clinical/caseload": "My Caseload",
  "/clinical/discharge": "Discharge Planning",
  "/clinical/follow-up": "Follow-up",
  "/clinical/referrals": "Referral Worklist",
  "/clinical/referrals/documents": "Referral Documents",
  "/clinical/pharmacy": "Medication Orders & Review",
  "/clinical/ipd/nursing": "Medication Administration",
  "/clinical/lims": "Laboratory Records",
  "/clinical/mhp/supervision": "Supervision Requests",
  "/clinical/mhp/nacada": "NACADA Report",
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
      searchSlot={<GlobalClientSearch />}
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
