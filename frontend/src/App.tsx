import { lazy, Suspense, type ComponentType } from "react";
import { Loader2 } from "lucide-react";
import { Navigate, Route, Routes } from "react-router-dom";
import { ActivationPage } from "./auth/ActivationPage";
import { ForgotPasswordPage } from "./auth/ForgotPasswordPage";
import { LoginPage } from "./auth/LoginPage";
import { ProtectedRoute, RootRedirect } from "./auth/ProtectedRoute";
import { ModulePlaceholder } from "./components/ModulePlaceholder";

// Named-export equivalent of React.lazy (which only accepts a default
// export) - keeps every page/shell as its own chunk instead of one ~700KB
// bundle covering all three portals (Clinical/Org Admin/Super Admin), even
// though a given user only ever loads one of them.
function lazyNamed<T extends ComponentType<any>>(
  factory: () => Promise<Record<string, T>>,
  name: string,
) {
  return lazy(() => factory().then((module) => ({ default: module[name] })));
}

const ClinicalWorkspaceShell = lazyNamed(
  () => import("./shells/ClinicalWorkspaceShell"),
  "ClinicalWorkspaceShell",
);
const OrgAdminShell = lazyNamed(() => import("./shells/OrgAdminShell"), "OrgAdminShell");
const SuperAdminShell = lazyNamed(() => import("./shells/SuperAdminShell"), "SuperAdminShell");

const MyProfilePage = lazyNamed(() => import("./modules/MyProfilePage"), "MyProfilePage");

const ClinicalDashboardPage = lazyNamed(
  () => import("./modules/clinical/ClinicalDashboardPage"),
  "ClinicalDashboardPage",
);
const ClientRegistryPage = lazyNamed(
  () => import("./modules/clinical/ClientRegistryPage"),
  "ClientRegistryPage",
);
const AppointmentsPage = lazyNamed(
  () => import("./modules/clinical/AppointmentsPage"),
  "AppointmentsPage",
);
const AttachmentsPage = lazyNamed(
  () => import("./modules/clinical/AttachmentsPage"),
  "AttachmentsPage",
);
const ClientHistoryPage = lazyNamed(
  () => import("./modules/clinical/ClientHistoryPage"),
  "ClientHistoryPage",
);
const PatientWorkspacePage = lazyNamed(
  () => import("./modules/clinical/PatientWorkspacePage"),
  "PatientWorkspacePage",
);
const NursingCarePage = lazyNamed(
  () => import("./modules/clinical/NursingCarePage"),
  "NursingCarePage",
);
const TriageMsePage = lazyNamed(() => import("./modules/clinical/TriageMsePage"), "TriageMsePage");
const ClinicalEncounterPage = lazyNamed(
  () => import("./modules/clinical/ClinicalEncounterPage"),
  "ClinicalEncounterPage",
);
const IndividualPsychotherapyPage = lazyNamed(
  () => import("./modules/clinical/IndividualPsychotherapyPage"),
  "IndividualPsychotherapyPage",
);
const FamilyTherapyPage = lazyNamed(
  () => import("./modules/clinical/FamilyTherapyPage"),
  "FamilyTherapyPage",
);
const GroupPsychotherapyPage = lazyNamed(
  () => import("./modules/clinical/GroupPsychotherapyPage"),
  "GroupPsychotherapyPage",
);
const LimsPage = lazyNamed(() => import("./modules/clinical/LimsPage"), "LimsPage");
const PharmacyPage = lazyNamed(() => import("./modules/clinical/PharmacyPage"), "PharmacyPage");
const IpdPage = lazyNamed(() => import("./modules/clinical/IpdPage"), "IpdPage");
const ClinicalReviewPage = lazyNamed(
  () => import("./modules/clinical/ClinicalReviewPage"),
  "ClinicalReviewPage",
);
const SupervisionRequestsPage = lazyNamed(
  () => import("./modules/clinical/SupervisionRequestsPage"),
  "SupervisionRequestsPage",
);
const NacadaReportPage = lazyNamed(
  () => import("./modules/clinical/NacadaReportPage"),
  "NacadaReportPage",
);

const ErasureRequestsPage = lazyNamed(
  () => import("./modules/org-admin/ErasureRequestsPage"),
  "ErasureRequestsPage",
);
const OrgDashboardPage = lazyNamed(
  () => import("./modules/org-admin/OrgDashboardPage"),
  "OrgDashboardPage",
);
const WardBedManagementPage = lazyNamed(
  () => import("./modules/org-admin/WardBedManagementPage"),
  "WardBedManagementPage",
);
const StaffTeamPage = lazyNamed(
  () => import("./modules/org-admin/StaffTeamPage"),
  "StaffTeamPage",
);
const OrgRolesPermissionsPage = lazyNamed(
  () => import("./modules/org-admin/OrgRolesPermissionsPage"),
  "OrgRolesPermissionsPage",
);
const BranchSettingsPage = lazyNamed(
  () => import("./modules/org-admin/BranchSettingsPage"),
  "BranchSettingsPage",
);
const BranchesAndDepartmentsPage = lazyNamed(
  () => import("./modules/org-admin/BranchesAndDepartmentsPage"),
  "BranchesAndDepartmentsPage",
);

const SecurityDashboardPage = lazyNamed(
  () => import("./modules/super-admin/SecurityDashboardPage"),
  "SecurityDashboardPage",
);
const SecurityPoliciesPage = lazyNamed(
  () => import("./modules/super-admin/SecurityPoliciesPage"),
  "SecurityPoliciesPage",
);
const TenantSecurityPage = lazyNamed(
  () => import("./modules/super-admin/TenantSecurityPage"),
  "TenantSecurityPage",
);
const SecurityAuditLogsPage = lazyNamed(
  () => import("./modules/super-admin/SecurityAuditLogsPage"),
  "SecurityAuditLogsPage",
);
const SecurityAlertsPage = lazyNamed(
  () => import("./modules/super-admin/SecurityAlertsPage"),
  "SecurityAlertsPage",
);
const PlatformDashboardPage = lazyNamed(
  () => import("./modules/super-admin/PlatformDashboardPage"),
  "PlatformDashboardPage",
);
const PlatformEmailSettingsPage = lazyNamed(
  () => import("./modules/super-admin/PlatformEmailSettingsPage"),
  "PlatformEmailSettingsPage",
);
const PlatformSmsSettingsPage = lazyNamed(
  () => import("./modules/super-admin/PlatformSmsSettingsPage"),
  "PlatformSmsSettingsPage",
);
const OrganizationsPage = lazyNamed(
  () => import("./modules/super-admin/OrganizationsPage"),
  "OrganizationsPage",
);
const BranchesPage = lazyNamed(
  () => import("./modules/super-admin/BranchesPage"),
  "BranchesPage",
);
const SubscriptionsPage = lazyNamed(
  () => import("./modules/super-admin/SubscriptionsPage"),
  "SubscriptionsPage",
);
const GlobalRolesPage = lazyNamed(
  () => import("./modules/super-admin/GlobalRolesPage"),
  "GlobalRolesPage",
);
const AuditLogPage = lazyNamed(
  () => import("./modules/super-admin/AuditLogPage"),
  "AuditLogPage",
);

function RouteLoadingFallback() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-surface-bg">
      <Loader2 className="h-6 w-6 animate-spin text-ink-400" />
    </div>
  );
}

function App() {
  return (
    <Suspense fallback={<RouteLoadingFallback />}>
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
            <Route path="sms-settings" element={<PlatformSmsSettingsPage />} />
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
            <Route path="branches" element={<BranchesAndDepartmentsPage />} />
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
            <Route path="mhp/individual" element={<IndividualPsychotherapyPage />} />
            <Route path="mhp/family" element={<FamilyTherapyPage />} />
            <Route path="mhp/group" element={<GroupPsychotherapyPage />} />
            <Route path="mhp/supervision" element={<SupervisionRequestsPage />} />
            <Route path="mhp/nacada" element={<NacadaReportPage />} />
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
    </Suspense>
  );
}

export default App;
