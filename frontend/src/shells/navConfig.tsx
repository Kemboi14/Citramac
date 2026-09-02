import {
  Activity,
  AlertTriangle,
  Building2,
  CalendarClock,
  ClipboardList,
  CreditCard,
  FileBarChart,
  FileClock,
  FileText,
  FlaskConical,
  HeartPulse,
  KeyRound,
  Landmark,
  LayoutDashboard,
  Mail,
  Paperclip,
  Pill,
  Settings,
  ShieldCheck,
  Stethoscope,
  Trash2,
  User,
  UserCog,
  Users,
  UsersRound,
} from "lucide-react";
import type { ComponentType } from "react";

export interface NavItem {
  label: string;
  to: string;
  icon: ComponentType<{ className?: string }>;
  soon?: boolean;
}

export interface NavGroup {
  label: string;
  items: NavItem[];
}

// Nav structure matches mockups/citramac_SUPER-ADMIN.html exactly — docs/03-DESIGN-SYSTEM.md §3.5.
export const SUPER_ADMIN_NAV: NavGroup[] = [
  {
    label: "Platform",
    items: [
      { label: "Platform Dashboard", to: "/super-admin", icon: LayoutDashboard },
      { label: "Organizations", to: "/super-admin/organizations", icon: Building2 },
      { label: "Branches", to: "/super-admin/branches", icon: Landmark },
      { label: "Subscriptions", to: "/super-admin/subscriptions", icon: CreditCard },
      { label: "Email Settings", to: "/super-admin/email-settings", icon: Mail },
    ],
  },
  {
    label: "Governance",
    items: [
      { label: "Roles & Permissions", to: "/super-admin/roles", icon: ShieldCheck },
      { label: "Audit Log", to: "/super-admin/audit-log", icon: ClipboardList },
      { label: "Security Dashboard", to: "/super-admin/security-dashboard", icon: ShieldCheck },
      { label: "Security Policies", to: "/super-admin/security-policies", icon: KeyRound },
      { label: "Tenant Security", to: "/super-admin/tenant-security", icon: Building2 },
      { label: "Security Audit Logs", to: "/super-admin/security-audit-logs", icon: FileClock },
      { label: "Security Alerts", to: "/super-admin/security-alerts", icon: AlertTriangle },
    ],
  },
];

// Matches mockups/citramac_ORG-admin.html — docs/03-DESIGN-SYSTEM.md §3.5.
export const ORG_ADMIN_NAV: NavGroup[] = [
  {
    label: "Facility",
    items: [
      { label: "Org Dashboard", to: "/org-admin", icon: LayoutDashboard },
      { label: "Ward & Bed Management", to: "/org-admin/wards", icon: Building2 },
      { label: "Staff / CCP Team", to: "/org-admin/staff", icon: Users },
      { label: "Branch Settings", to: "/org-admin/branch-settings", icon: Settings },
      { label: "Roles & Permissions", to: "/org-admin/roles", icon: ShieldCheck },
    ],
  },
  {
    label: "Governance",
    items: [{ label: "Data Requests", to: "/org-admin/data-requests", icon: Trash2 }],
  },
];

// Matches mockups/citramac_clinical_workspace.html — docs/03-DESIGN-SYSTEM.md §3.5.
export const CLINICAL_NAV: NavGroup[] = [
  {
    label: "Workspace",
    items: [{ label: "Dashboard", to: "/clinical", icon: LayoutDashboard }],
  },
  {
    label: "Core Clinical (DHA)",
    items: [
      { label: "Client Registry", to: "/clinical/registry", icon: FileText },
      { label: "Client History", to: "/clinical/client-history", icon: ClipboardList },
      { label: "Attachments", to: "/clinical/attachments", icon: Paperclip },
      { label: "Appointments", to: "/clinical/appointments", icon: CalendarClock },
      { label: "Triage & MSE", to: "/clinical/triage", icon: Activity },
      { label: "Clinical Review", to: "/clinical/review", icon: Stethoscope },
      { label: "Clinical Encounter", to: "/clinical/encounter", icon: FileText },
      { label: "Laboratory (LIMS)", to: "/clinical/lims", icon: FlaskConical },
      { label: "Pharmacy", to: "/clinical/pharmacy", icon: Pill },
      { label: "Inpatient & Ward / Admission", to: "/clinical/ipd", icon: Building2 },
      { label: "Psychiatric Nursing", to: "/clinical/ipd/nursing", icon: HeartPulse },
    ],
  },
  {
    label: "CCP Program",
    items: [
      { label: "Individual Psychotherapy", to: "/clinical/ccp/individual", icon: User },
      { label: "Family Therapy", to: "/clinical/ccp/family", icon: Users },
      { label: "Group Psychotherapy", to: "/clinical/ccp/group", icon: UsersRound },
      {
        label: "Supervision Requests",
        to: "/clinical/ccp/supervision",
        icon: ShieldCheck,
      },
      { label: "NACADA NDO Report", to: "/clinical/ccp/nacada", icon: FileBarChart },
      { label: "CCP Team", to: "/clinical/ccp/team", icon: UserCog },
    ],
  },
  {
    // Named in mockups/citramac_clinical_workspace.html but with no backing
    // model/spec anywhere (docs/07-CLINICAL-MODULES-SPEC.md) — listed
    // honestly as unbuilt rather than either hidden or faked, matching this
    // shell's existing "soon" pattern (see AppShell.tsx / docs/03 §3.5).
    label: "Coming Soon",
    items: [
      {
        label: "CORI / CRI Assessments",
        to: "/clinical/soon/assessments",
        icon: ClipboardList,
        soon: true,
      },
      {
        label: "MOH Clinical Reports",
        to: "/clinical/soon/moh-reports",
        icon: FileBarChart,
        soon: true,
      },
      {
        label: "Physical Exercise",
        to: "/clinical/soon/physical-exercise",
        icon: Activity,
        soon: true,
      },
      { label: "Bills and Claims", to: "/clinical/soon/billing", icon: CreditCard, soon: true },
      { label: "Centre Operations", to: "/clinical/soon/centre-ops", icon: Building2, soon: true },
    ],
  },
];
