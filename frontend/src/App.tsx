import { Navigate, Route, Routes } from "react-router-dom";
import { ActivationPage } from "./auth/ActivationPage";
import { ForgotPasswordPage } from "./auth/ForgotPasswordPage";
import { LoginPage } from "./auth/LoginPage";
import { ProtectedRoute, RootRedirect } from "./auth/ProtectedRoute";
import { ClinicalWorkspaceShell } from "./shells/ClinicalWorkspaceShell";
import { OrgAdminShell } from "./shells/OrgAdminShell";
import { SuperAdminShell } from "./shells/SuperAdminShell";
import { PlaceholderPage } from "./modules/PlaceholderPage";
import { ClientRegistryPage } from "./modules/clinical/ClientRegistryPage";
import { NewClientPage } from "./modules/clinical/NewClientPage";
import { TriageMsePage } from "./modules/clinical/TriageMsePage";
import { ClinicalEncounterPage } from "./modules/clinical/ClinicalEncounterPage";
import { IndividualPsychotherapyPage } from "./modules/clinical/IndividualPsychotherapyPage";
import { FamilyTherapyPage } from "./modules/clinical/FamilyTherapyPage";
import { GroupPsychotherapyPage } from "./modules/clinical/GroupPsychotherapyPage";
import { LimsPage } from "./modules/clinical/LimsPage";
import { PharmacyPage } from "./modules/clinical/PharmacyPage";
import { IpdPage } from "./modules/clinical/IpdPage";
import { ClinicalReviewPage } from "./modules/clinical/ClinicalReviewPage";
import { SupervisionRequestsPage } from "./modules/clinical/SupervisionRequestsPage";
import { CcpTeamPage } from "./modules/clinical/CcpTeamPage";
import { NacadaReportPage } from "./modules/clinical/NacadaReportPage";

function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/activate" element={<ActivationPage />} />
      <Route path="/forgot-password" element={<ForgotPasswordPage />} />

      <Route path="/" element={<RootRedirect />} />

      <Route element={<ProtectedRoute allowedRoles={["SUPER_ADMIN"]} />}>
        <Route path="/super-admin" element={<SuperAdminShell />}>
          <Route
            index
            element={<PlaceholderPage eyebrow="Super Admin" title="Platform Dashboard" />}
          />
          <Route
            path="organizations"
            element={<PlaceholderPage eyebrow="Super Admin · Platform" title="Organizations" />}
          />
          <Route
            path="branches"
            element={<PlaceholderPage eyebrow="Super Admin · Platform" title="Branches" />}
          />
          <Route
            path="subscriptions"
            element={
              <PlaceholderPage eyebrow="Super Admin · Platform" title="Subscriptions & Billing" />
            }
          />
          <Route
            path="roles"
            element={
              <PlaceholderPage
                eyebrow="Super Admin · Governance"
                title="Global Roles & Permissions"
              />
            }
          />
          <Route
            path="audit-log"
            element={<PlaceholderPage eyebrow="Super Admin · Governance" title="Audit Log" />}
          />
        </Route>
      </Route>

      <Route element={<ProtectedRoute allowedRoles={["Org Admin"]} />}>
        <Route path="/org-admin" element={<OrgAdminShell />}>
          <Route
            index
            element={<PlaceholderPage eyebrow="Organization Admin" title="Org Dashboard" />}
          />
          <Route
            path="wards"
            element={<PlaceholderPage eyebrow="Facility" title="Ward & Bed Management" />}
          />
          <Route
            path="staff"
            element={<PlaceholderPage eyebrow="Facility" title="Staff & CCP Team" />}
          />
          <Route
            path="branch-settings"
            element={<PlaceholderPage eyebrow="Facility" title="Branch Settings" />}
          />
          <Route
            path="roles"
            element={
              <PlaceholderPage eyebrow="Facility · Governance" title="Roles & Permissions" />
            }
          />
        </Route>
      </Route>

      {/* Everyone else authenticated (Doctor, Nurse, Therapist, etc.) — the frontline Clinical Workspace. */}
      <Route element={<ProtectedRoute />}>
        <Route path="/clinical" element={<ClinicalWorkspaceShell />}>
          <Route index element={<ClientRegistryPage />} />
          <Route path="registry-new" element={<NewClientPage />} />
          <Route
            path="attachments"
            element={<PlaceholderPage eyebrow="Module 1" title="Attachments" />}
          />
          <Route path="triage" element={<TriageMsePage />} />
          <Route path="review" element={<ClinicalReviewPage />} />
          <Route path="encounter" element={<ClinicalEncounterPage />} />
          <Route path="lims" element={<LimsPage />} />
          <Route path="pharmacy" element={<PharmacyPage />} />
          <Route path="ipd" element={<IpdPage />} />
          <Route path="ccp/individual" element={<IndividualPsychotherapyPage />} />
          <Route path="ccp/family" element={<FamilyTherapyPage />} />
          <Route path="ccp/group" element={<GroupPsychotherapyPage />} />
          <Route path="ccp/supervision" element={<SupervisionRequestsPage />} />
          <Route path="ccp/nacada" element={<NacadaReportPage />} />
          <Route path="ccp/team" element={<CcpTeamPage />} />
        </Route>
      </Route>

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

export default App;
