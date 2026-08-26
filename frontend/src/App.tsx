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
import { ErasureRequestsPage } from "./modules/org-admin/ErasureRequestsPage";
import { SecurityDashboardPage } from "./modules/super-admin/SecurityDashboardPage";
import { SecurityPoliciesPage } from "./modules/super-admin/SecurityPoliciesPage";
import { TenantSecurityPage } from "./modules/super-admin/TenantSecurityPage";
import { SecurityAuditLogsPage } from "./modules/super-admin/SecurityAuditLogsPage";
import { SecurityAlertsPage } from "./modules/super-admin/SecurityAlertsPage";
import { PlatformDashboardPage } from "./modules/super-admin/PlatformDashboardPage";
import { OrganizationsPage } from "./modules/super-admin/OrganizationsPage";
import { BranchesPage } from "./modules/super-admin/BranchesPage";
import { SubscriptionsPage } from "./modules/super-admin/SubscriptionsPage";
import { GlobalRolesPage } from "./modules/super-admin/GlobalRolesPage";
import { AuditLogPage } from "./modules/super-admin/AuditLogPage";
import { OrgDashboardPage } from "./modules/org-admin/OrgDashboardPage";
import { WardBedManagementPage } from "./modules/org-admin/WardBedManagementPage";
import { StaffTeamPage } from "./modules/org-admin/StaffTeamPage";
import { OrgRolesPermissionsPage } from "./modules/org-admin/OrgRolesPermissionsPage";
import { BranchSettingsPage } from "./modules/org-admin/BranchSettingsPage";

function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/activate" element={<ActivationPage />} />
      <Route path="/forgot-password" element={<ForgotPasswordPage />} />

      <Route path="/" element={<RootRedirect />} />

      <Route element={<ProtectedRoute allowedRoles={["SUPER_ADMIN"]} />}>
        <Route path="/super-admin" element={<SuperAdminShell />}>
          <Route index element={<PlatformDashboardPage />} />
          <Route path="organizations" element={<OrganizationsPage />} />
          <Route path="branches" element={<BranchesPage />} />
          <Route path="subscriptions" element={<SubscriptionsPage />} />
          <Route path="roles" element={<GlobalRolesPage />} />
          <Route path="audit-log" element={<AuditLogPage />} />
          <Route path="security-dashboard" element={<SecurityDashboardPage />} />
          <Route path="security-policies" element={<SecurityPoliciesPage />} />
          <Route path="tenant-security" element={<TenantSecurityPage />} />
          <Route path="security-audit-logs" element={<SecurityAuditLogsPage />} />
          <Route path="security-alerts" element={<SecurityAlertsPage />} />
        </Route>
      </Route>

      <Route element={<ProtectedRoute allowedRoles={["Org Admin"]} />}>
        <Route path="/org-admin" element={<OrgAdminShell />}>
          <Route index element={<OrgDashboardPage />} />
          <Route path="wards" element={<WardBedManagementPage />} />
          <Route path="staff" element={<StaffTeamPage />} />
          <Route path="branch-settings" element={<BranchSettingsPage />} />
          <Route path="roles" element={<OrgRolesPermissionsPage />} />
          <Route path="data-requests" element={<ErasureRequestsPage />} />
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
