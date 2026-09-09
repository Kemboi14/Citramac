import {
  Activity,
  AlertTriangle,
  Building2,
  CalendarClock,
  ClipboardCheck,
  ClipboardList,
  CreditCard,
  Dumbbell,
  FileBarChart,
  FileClock,
  FileText,
  FlaskConical,
  HeartPulse,
  KeyRound,
  Landmark,
  LayoutDashboard,
  LifeBuoy,
  LogOut,
  Mail,
  Paperclip,
  Phone,
  Pill,
  Settings,
  ShieldCheck,
  Stethoscope,
  Syringe,
  Trash2,
  User,
  Users,
  UsersRound,
} from "lucide-react";
import type { ComponentType } from "react";

export interface NavItem {
  label: string;
  /** Absent when this item is purely an expandable group trigger (has `children`). */
  to?: string;
  icon: ComponentType<{ className?: string }>;
  /** Fully disabled/greyed "Soon" treatment — never clickable, never expandable. */
  soon?: boolean;
  /** One level of nested, always-navigable sub-items (expandable accordion group). */
  children?: NavItem[];
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

// Rebuilt against the second (2026-09) clinical-workspace mockup. See
// /home/nick/.claude/plans/drifting-baking-falcon.md for the full mapping
// table and rationale for every relocation/placeholder/deletion below —
// this nav is not a 1:1 mirror of that mockup's raw nav-item list: Lab and
// Pharmacy stay live/reachable (deviating from the mockup's disabled
// placement) because they already work against the real backend, and CCP
// Team is deleted entirely (matching the mockup, which has no nav slot for
// it at all). Items marked `soon` are the mockup's genuinely disabled
// leaves (Physical Exercise, Bills and Claims, Centre Operations); every
// other new leaf below is enabled and either reuses an existing real
// screen or renders <ModulePlaceholder> honestly — see each page's own
// comment for which case it is.
export const CLINICAL_NAV: NavGroup[] = [
  {
    label: "Workspace",
    items: [
      { label: "Dashboard", to: "/clinical", icon: LayoutDashboard },
      { label: "Appointments", to: "/clinical/appointments", icon: CalendarClock },
    ],
  },
  {
    label: "Clinical",
    items: [
      { label: "Client Registry", to: "/clinical/registry", icon: FileText },
      { label: "Admission", to: "/clinical/ipd", icon: Building2 },
      { label: "Client History", to: "/clinical/client-history", icon: ClipboardList },
      {
        label: "Assessments",
        icon: ClipboardCheck,
        children: [
          { label: "CORI", to: "/clinical/assessments/cori", icon: ClipboardCheck },
          { label: "CRI", to: "/clinical/assessments/cri", icon: ClipboardCheck },
          {
            label: "Attached Assessments",
            to: "/clinical/assessments/attached",
            icon: Paperclip,
          },
          { label: "Others", to: "/clinical/assessments/others", icon: ClipboardCheck },
        ],
      },
      {
        label: "Psychiatry",
        icon: Stethoscope,
        children: [
          { label: "Initial Consultation", to: "/clinical/encounter", icon: FileText },
          { label: "Psychiatric Review", to: "/clinical/encounter", icon: FileText },
          { label: "MSE", to: "/clinical/triage", icon: Activity },
          {
            label: "Risk Assessment",
            to: "/clinical/psychiatry/risk-assessment",
            icon: AlertTriangle,
          },
          { label: "Diagnosis", to: "/clinical/patient", icon: Stethoscope },
          { label: "Medication Order(s)", to: "/clinical/pharmacy", icon: Pill },
          { label: "Allergies", to: "/clinical/psychiatry/allergies", icon: Syringe },
        ],
      },
      {
        label: "Psychiatric Nursing",
        icon: HeartPulse,
        children: [
          { label: "Clinical Review", to: "/clinical/review", icon: Stethoscope },
          {
            label: "Medication Administration Record",
            to: "/clinical/ipd/nursing",
            icon: Pill,
          },
          { label: "General Observations", to: "/clinical/triage", icon: Activity },
          { label: "MSE", to: "/clinical/triage", icon: Activity },
          {
            label: "Telephone and PRN Orders",
            to: "/clinical/nursing/prn-orders",
            icon: Phone,
          },
        ],
      },
      {
        label: "Psychotherapy",
        icon: User,
        children: [
          { label: "Individual Psychotherapy", to: "/clinical/ccp/individual", icon: User },
          { label: "Group Psychotherapy", to: "/clinical/ccp/group", icon: UsersRound },
          { label: "Family Therapy", to: "/clinical/ccp/family", icon: Users },
          {
            label: "Morning Meeting Observations",
            to: "/clinical/psychotherapy/morning-meeting",
            icon: ClipboardList,
          },
          {
            label: "General Observations",
            to: "/clinical/psychotherapy/general-observations",
            icon: ClipboardList,
          },
        ],
      },
      {
        label: "Physical Exercise",
        to: "/clinical/soon/physical-exercise",
        icon: Dumbbell,
        soon: true,
      },
      {
        label: "Supervision",
        icon: ShieldCheck,
        children: [
          { label: "Supervision Requests", to: "/clinical/ccp/supervision", icon: ShieldCheck },
          {
            label: "Supervision Sessions",
            to: "/clinical/supervision/sessions",
            icon: ShieldCheck,
          },
        ],
      },
      { label: "Attachments", to: "/clinical/attachments", icon: Paperclip },
      {
        label: "Discharge",
        icon: LogOut,
        children: [
          {
            label: "Longitudinal View of all Care to date",
            to: "/clinical/discharge/longitudinal-view",
            icon: FileClock,
          },
          {
            label: "Discharge Summary",
            to: "/clinical/discharge/summary",
            icon: FileText,
          },
          {
            label: "Generate Medical Report",
            to: "/clinical/discharge/medical-report",
            icon: FileBarChart,
          },
        ],
      },
      { label: "Follow-up and After-care", to: "/clinical/followup", icon: LifeBuoy },
      {
        label: "Clinical Reports",
        icon: FileBarChart,
        children: [
          { label: "NACADA", to: "/clinical/ccp/nacada", icon: FileBarChart },
          { label: "MOH", to: "/clinical/reports/moh", icon: FileBarChart },
          { label: "MOH - Discharge", to: "/clinical/reports/moh-discharge", icon: FileBarChart },
          { label: "Others", to: "/clinical/reports/others", icon: FileBarChart },
        ],
      },
      // Kept live and reachable per the plan's decision 1 — deviates from
      // the mockup, which buries these (disabled) under Centre Operations.
      { label: "Laboratory (LIMS)", to: "/clinical/lims", icon: FlaskConical },
      { label: "Pharmacy", to: "/clinical/pharmacy", icon: Pill },
    ],
  },
  {
    label: "Coming Soon",
    items: [
      { label: "Bills and Claims", to: "/clinical/soon/billing", icon: CreditCard, soon: true },
      {
        label: "Centre Operations",
        to: "/clinical/soon/centre-ops",
        icon: Building2,
        soon: true,
      },
    ],
  },
];
