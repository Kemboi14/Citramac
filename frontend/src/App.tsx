import { Navigate, Route, Routes } from "react-router-dom";
import { ActivationPage } from "./auth/ActivationPage";
import { ForgotPasswordPage } from "./auth/ForgotPasswordPage";
import { LoginPage } from "./auth/LoginPage";
import { ProtectedRoute, RootRedirect } from "./auth/ProtectedRoute";
import { ClinicalWorkspaceShell } from "./shells/ClinicalWorkspaceShell";
import { OrgAdminShell } from "./shells/OrgAdminShell";
import { SuperAdminShell } from "./shells/SuperAdminShell";
import { PlaceholderPage } from "./modules/PlaceholderPage";

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
          <Route
            index
            element={
              <PlaceholderPage eyebrow="Module 1 · Patient Registration" title="Client Registry" />
            }
          />
          <Route
            path="attachments"
            element={<PlaceholderPage eyebrow="Module 1" title="Attachments" />}
          />
          <Route
            path="triage"
            element={
              <PlaceholderPage eyebrow="Module 2 · Triage & Biopsychosocial" title="Triage & MSE" />
            }
          />
          <Route
            path="review"
            element={
              <PlaceholderPage
                eyebrow="Module 2 · Ongoing Clinical Review"
                title="Clinical Review"
              />
            }
          />
          <Route
            path="encounter"
            element={
              <PlaceholderPage
                eyebrow="Module 3 · Clinical Encounter (EHR)"
                title="Clinical Encounter"
              />
            }
          />
          <Route
            path="ccp/individual"
            element={
              <PlaceholderPage
                eyebrow="CCP · Individual Psychotherapy"
                title="Individual Session Form"
              />
            }
          />
          <Route
            path="ccp/family"
            element={
              <PlaceholderPage eyebrow="CCP · Family Therapy" title="Family Therapy Session" />
            }
          />
          <Route
            path="ccp/group"
            element={<PlaceholderPage eyebrow="CCP · Group Psychotherapy" title="Group Session" />}
          />
          <Route
            path="ccp/nacada"
            element={
              <PlaceholderPage eyebrow="CCP · Regulatory Reporting" title="NACADA NDO Report" />
            }
          />
        </Route>
      </Route>

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

export default App;
