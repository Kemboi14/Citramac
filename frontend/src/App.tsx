import { Navigate, Route, Routes } from "react-router-dom";
import { ActivationPage } from "./auth/ActivationPage";
import { ForgotPasswordPage } from "./auth/ForgotPasswordPage";
import { LoginPage } from "./auth/LoginPage";
import { ProtectedRoute, RootRedirect } from "./auth/ProtectedRoute";
import { ClinicalWorkspaceShell } from "./shells/ClinicalWorkspaceShell";
import { OrgAdminShell } from "./shells/OrgAdminShell";
import { SuperAdminShell } from "./shells/SuperAdminShell";
import { ClinicalDashboardPage } from "./modules/clinical/ClinicalDashboardPage";
import { ClientRegistryPage } from "./modules/clinical/ClientRegistryPage";
import { AppointmentsPage } from "./modules/clinical/AppointmentsPage";
import { AttachmentsPage } from "./modules/clinical/AttachmentsPage";
import { ClientHistoryPage } from "./modules/clinical/ClientHistoryPage";
import { PatientWorkspacePage } from "./modules/clinical/PatientWorkspacePage";
import { NursingCarePage } from "./modules/clinical/NursingCarePage";
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
import { NacadaReportPage } from "./modules/clinical/NacadaReportPage";
import { ModulePlaceholder } from "./components/ModulePlaceholder";
import { MyProfilePage } from "./modules/MyProfilePage";
import { ErasureRequestsPage } from "./modules/org-admin/ErasureRequestsPage";
import { SecurityDashboardPage } from "./modules/super-admin/SecurityDashboardPage";
import { SecurityPoliciesPage } from "./modules/super-admin/SecurityPoliciesPage";
import { TenantSecurityPage } from "./modules/super-admin/TenantSecurityPage";
import { SecurityAuditLogsPage } from "./modules/super-admin/SecurityAuditLogsPage";
import { SecurityAlertsPage } from "./modules/super-admin/SecurityAlertsPage";
import { PlatformDashboardPage } from "./modules/super-admin/PlatformDashboardPage";
import { PlatformEmailSettingsPage } from "./modules/super-admin/PlatformEmailSettingsPage";
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
          <Route path="email-settings" element={<PlatformEmailSettingsPage />} />
          <Route path="roles" element={<GlobalRolesPage />} />
          <Route path="audit-log" element={<AuditLogPage />} />
          <Route path="security-dashboard" element={<SecurityDashboardPage />} />
          <Route path="security-policies" element={<SecurityPoliciesPage />} />
          <Route path="tenant-security" element={<TenantSecurityPage />} />
          <Route path="security-audit-logs" element={<SecurityAuditLogsPage />} />
          <Route path="security-alerts" element={<SecurityAlertsPage />} />
          <Route path="profile" element={<MyProfilePage />} />
        </Route>
      </Route>

      <Route element={<ProtectedRoute allowedRoles={["Org Admin"]} />}>
        <Route path="/org-admin" element={<OrgAdminShell />}>
          <Route index element={<OrgDashboardPage />} />
          <Route path="wards" element={<WardBedManagementPage />} />
          <Route path="staff" element={<StaffTeamPage />} />
          <Route path="branch-settings" element={<BranchSettingsPage />} />
          <Route path="roles" element={<OrgRolesPermissionsPage />} />
          <Route path="profile" element={<MyProfilePage />} />
          <Route path="data-requests" element={<ErasureRequestsPage />} />
        </Route>
      </Route>

      {/* Everyone else authenticated (Doctor, Nurse, Therapist, etc.) — the frontline Clinical Workspace. */}
      <Route element={<ProtectedRoute />}>
        <Route path="/clinical" element={<ClinicalWorkspaceShell />}>
          <Route index element={<ClinicalDashboardPage />} />
          <Route path="registry" element={<ClientRegistryPage />} />
          <Route path="patient" element={<PatientWorkspacePage />} />
          <Route path="attachments" element={<AttachmentsPage />} />
          <Route path="appointments" element={<AppointmentsPage />} />
          <Route path="client-history" element={<ClientHistoryPage />} />
          <Route path="ipd/nursing" element={<NursingCarePage />} />
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
          <Route path="profile" element={<MyProfilePage />} />

          {/*
            Honest placeholders — nav leaves from the new mockup with no
            backing model/spec anywhere (docs/07-CLINICAL-MODULES-SPEC.md).
            See /home/nick/.claude/plans/drifting-baking-falcon.md.
          */}
          <Route
            path="assessments/cori"
            element={
              <ModulePlaceholder
                eyebrow="Assessments"
                title="CORI"
                description="Client Outcome Routine Instrument assessment."
              />
            }
          />
          <Route
            path="assessments/cri"
            element={
              <ModulePlaceholder
                eyebrow="Assessments"
                title="CRI"
                description="Client Recovery Instrument assessment."
              />
            }
          />
          <Route
            path="assessments/attached"
            element={
              <ModulePlaceholder
                eyebrow="Assessments"
                title="Attached Assessments"
                description="Externally administered or scanned-in structured assessments."
              />
            }
          />
          <Route
            path="assessments/others"
            element={
              <ModulePlaceholder
                eyebrow="Assessments"
                title="Other Assessments"
                description="Other structured assessment instruments."
              />
            }
          />
          <Route
            path="psychiatry/risk-assessment"
            element={
              <ModulePlaceholder
                eyebrow="Psychiatry"
                title="Risk Assessment"
                description="Standalone psychiatric risk assessment note."
              />
            }
          />
          <Route
            path="psychiatry/allergies"
            element={
              <ModulePlaceholder
                eyebrow="Psychiatry"
                title="Allergies"
                description="Structured allergy list, distinct from the free-text allergy field captured at registration."
              />
            }
          />
          <Route
            path="nursing/prn-orders"
            element={
              <ModulePlaceholder
                eyebrow="Psychiatric Nursing"
                title="Telephone and PRN Orders"
                description="Telephone orders and as-needed (PRN) medication orders."
              />
            }
          />
          <Route
            path="psychotherapy/morning-meeting"
            element={
              <ModulePlaceholder
                eyebrow="Psychotherapy"
                title="Morning Meeting Observations"
                description="Daily morning community-meeting observations."
              />
            }
          />
          <Route
            path="psychotherapy/general-observations"
            element={
              <ModulePlaceholder
                eyebrow="Psychotherapy"
                title="General Observations"
                description="General therapist observations outside a scheduled session."
              />
            }
          />
          <Route
            path="supervision/sessions"
            element={
              <ModulePlaceholder
                eyebrow="Supervision"
                title="Supervision Sessions"
                description="Scheduled clinical-supervision session log, distinct from ad hoc Supervision Requests."
              />
            }
          />
          <Route
            path="discharge/longitudinal-view"
            element={
              <ModulePlaceholder
                eyebrow="Discharge"
                title="Longitudinal View of all Care to date"
                description="Full chronological view of a client's care across every module."
              />
            }
          />
          <Route
            path="discharge/summary"
            element={
              <ModulePlaceholder
                eyebrow="Discharge"
                title="Discharge Summary"
                description="Structured discharge summary document."
              />
            }
          />
          <Route
            path="discharge/medical-report"
            element={
              <ModulePlaceholder
                eyebrow="Discharge"
                title="Generate Medical Report"
                description="Generate a formatted medical report for external use."
              />
            }
          />
          <Route
            path="followup"
            element={
              <ModulePlaceholder
                eyebrow="Clinical"
                title="Follow-up and After-care"
                description="Post-discharge follow-up and after-care tracking."
              />
            }
          />
          <Route
            path="reports/moh"
            element={
              <ModulePlaceholder
                eyebrow="Clinical Reports"
                title="MOH Clinical Reports"
                description="Ministry of Health clinical reporting."
              />
            }
          />
          <Route
            path="reports/moh-discharge"
            element={
              <ModulePlaceholder
                eyebrow="Clinical Reports"
                title="MOH - Discharge"
                description="Ministry of Health discharge reporting."
              />
            }
          />
          <Route
            path="reports/others"
            element={
              <ModulePlaceholder
                eyebrow="Clinical Reports"
                title="Other Clinical Reports"
                description="Other regulatory or internal clinical reports."
              />
            }
          />
        </Route>
      </Route>

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

export default App;
