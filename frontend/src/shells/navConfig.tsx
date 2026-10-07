import {
  Activity,
  AlertTriangle,
  Archive,
  Building2,
  CalendarClock,
  ClipboardCheck,
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
  MessageSquare,
  Network,
  Palette,
  Paperclip,
  Pill,
  Settings,
  ShieldAlert,
  ShieldCheck,
  Stethoscope,
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
  /** An expandable group that starts open. */
  defaultOpen?: boolean;
  /** Stay highlighted on deeper routes too (e.g. /clinical/triage/:id). */
  matchPrefix?: boolean;
  /** Other route prefixes that should highlight this item. */
  alsoActiveFor?: string[];
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
      { label: "Branches & Departments", to: "/super-admin/branches", icon: Landmark },
      { label: "Subscriptions", to: "/super-admin/subscriptions", icon: CreditCard },
      { label: "Data Lifecycle", to: "/super-admin/data-lifecycle", icon: Archive },
      { label: "Email Settings", to: "/super-admin/email-settings", icon: Mail },
      { label: "SMS Settings", to: "/super-admin/sms-settings", icon: MessageSquare },
      { label: "Theme & Colors", to: "/super-admin/theme", icon: Palette },
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
  {
    label: "Data Protection",
    items: [
      { label: "Breach Incidents", to: "/super-admin/breach-incidents", icon: ShieldAlert },
      { label: "Support Access", to: "/super-admin/support-access", icon: KeyRound },
      { label: "Tenant Compliance", to: "/super-admin/tenant-compliance", icon: ClipboardCheck },
      { label: "Platform DPO & Warranty", to: "/super-admin/platform-compliance", icon: Landmark },
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
      { label: "Branches & Departments", to: "/org-admin/branches", icon: Network },
      { label: "Staff / MHP Team", to: "/org-admin/staff", icon: Users },
      { label: "Branch Settings", to: "/org-admin/branch-settings", icon: Settings },
      { label: "Roles & Permissions", to: "/org-admin/roles", icon: ShieldCheck },
      { label: "Subscription", to: "/org-admin/subscription", icon: CreditCard },
      { label: "Service Tariff", to: "/org-admin/service-tariff", icon: Landmark },
      { label: "Consent Wording", to: "/org-admin/consent-wording", icon: FileText },
    ],
  },
  {
    label: "Governance",
    items: [
      { label: "Data Requests", to: "/org-admin/data-requests", icon: Trash2 },
      { label: "Data Protection", to: "/org-admin/data-protection", icon: ClipboardCheck },
      { label: "Breach Incidents", to: "/org-admin/breach-incidents", icon: ShieldAlert },
      { label: "Support Access", to: "/org-admin/support-access", icon: KeyRound },
      { label: "Data Retention & Archive", to: "/org-admin/data-retention", icon: Archive },
    ],
  },
];

// docs/15-CLINICAL-WORKSPACE-V3.md §1.1 — the approved 2026-10-07 mockup
// (mockups/citramac_clinical_workspace.html), item for item and in order:
// no section headings, Clinical and Psychotherapy open by default. The
// screens the mockup has no slot for stay available under a collapsed
// "Other clinical modules" group (owner's decision: they remain).
export const CLINICAL_NAV: NavGroup[] = [
  {
    label: "",
    items: [
      { label: "Dashboard", to: "/clinical", icon: LayoutDashboard },
      { label: "My Caseload", to: "/clinical/caseload", icon: Users },
      { label: "Appointments", to: "/clinical/appointments", icon: CalendarClock },
      {
        label: "Clinical",
        icon: Stethoscope,
        defaultOpen: true,
        children: [
          { label: "Registration", to: "/clinical/registration", icon: FileText },
          { label: "Triage", to: "/clinical/triage", icon: Activity, matchPrefix: true },
          {
            label: "Psychiatric",
            to: "/clinical/psychiatry",
            icon: Stethoscope,
            alsoActiveFor: ["/clinical/clients"],
          },
          {
            label: "Inpatient",
            to: "/clinical/inpatient",
            icon: Building2,
            matchPrefix: true,
          },
        ],
      },
      {
        label: "Psychotherapy",
        icon: HeartPulse,
        defaultOpen: true,
        children: [
          {
            label: "Individual Psychotherapy",
            to: "/clinical/psychotherapy/individual",
            icon: User,
          },
          { label: "Family Psychotherapy", to: "/clinical/psychotherapy/family", icon: Users },
          {
            label: "Group Psychotherapy",
            to: "/clinical/psychotherapy/group",
            icon: UsersRound,
          },
        ],
      },
      { label: "Documents", to: "/clinical/documents", icon: FileText, matchPrefix: true },
      { label: "Billing", to: "/clinical/billing", icon: CreditCard },
      { label: "Reports", to: "/clinical/reports", icon: FileBarChart },
      {
        label: "Other clinical modules",
        icon: ClipboardList,
        children: [
          { label: "Client Registry", to: "/clinical/registry", icon: FileText },
          { label: "Client History", to: "/clinical/client-history", icon: ClipboardList },
          { label: "Clinical Encounter (SOAP)", to: "/clinical/encounter", icon: Stethoscope },
          { label: "Triage & MSE", to: "/clinical/triage-mse", icon: Activity },
          { label: "Clinical Review", to: "/clinical/review", icon: ShieldCheck },
          { label: "Admissions & Ward Workflow", to: "/clinical/ipd", icon: Building2 },
          { label: "Nursing Care & MAR", to: "/clinical/ipd/nursing", icon: HeartPulse },
          { label: "Laboratory (LIMS)", to: "/clinical/lims", icon: FlaskConical },
          { label: "Pharmacy", to: "/clinical/pharmacy", icon: Pill },
          { label: "Individual Sessions", to: "/clinical/mhp/individual", icon: User },
          { label: "Family Sessions", to: "/clinical/mhp/family", icon: Users },
          { label: "Group Sessions", to: "/clinical/mhp/group", icon: UsersRound },
          { label: "Supervision Requests", to: "/clinical/mhp/supervision", icon: ShieldCheck },
          { label: "Attachments", to: "/clinical/attachments", icon: Paperclip },
          { label: "NACADA Report", to: "/clinical/mhp/nacada", icon: FileBarChart },
        ],
      },
    ],
  },
];
