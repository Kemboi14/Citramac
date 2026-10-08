import {
  Activity,
  AlertTriangle,
  Archive,
  BarChart3,
  BedDouble,
  Building2,
  CalendarCheck,
  CalendarClock,
  ClipboardCheck,
  ClipboardList,
  CreditCard,
  DoorOpen,
  FileBarChart,
  FileClock,
  FileText,
  FlaskConical,
  HeartPulse,
  KeyRound,
  Landmark,
  LayoutDashboard,
  ListChecks,
  Mail,
  MessageSquare,
  Network,
  Palette,
  Pill,
  Settings,
  Share2,
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
      { label: "Audit Log", to: "/org-admin/audit-log", icon: ClipboardList },
      { label: "Data Requests", to: "/org-admin/data-requests", icon: Trash2 },
      { label: "Data Protection", to: "/org-admin/data-protection", icon: ClipboardCheck },
      { label: "Breach Incidents", to: "/org-admin/breach-incidents", icon: ShieldAlert },
      { label: "Support Access", to: "/org-admin/support-access", icon: KeyRound },
      { label: "Data Retention & Archive", to: "/org-admin/data-retention", icon: Archive },
    ],
  },
];

// The Auditor role has no portal of its own: it gets the Org Admin shell with
// the audit log as its only screen.
export const AUDITOR_NAV: NavGroup[] = [
  {
    label: "Governance",
    items: [{ label: "Audit Log", to: "/org-admin/audit-log", icon: ClipboardList }],
  },
];

// docs/15-CLINICAL-WORKSPACE-V3.md §1.1 — the owner-approved grouped clinical
// sidebar (mockups/citramac_clinical_workspace.html), item for item and in
// order. Clinical and Psychotherapy start open; every other group starts
// collapsed and opens itself when the current route is inside it. Screens the
// mockup has no slot for (Client Registry, Client History, SOAP, Triage & MSE,
// Clinical Review, Attachments, MHP sessions) are no longer in the sidebar but
// keep their routes. The Audit log is deliberately absent here: it is an Org
// Admin / Auditor screen (ORG_ADMIN_NAV).
export const CLINICAL_NAV: NavGroup[] = [
  {
    label: "",
    items: [
      { label: "Dashboard", to: "/clinical", icon: LayoutDashboard },
      { label: "My Caseload", to: "/clinical/caseload", icon: Users },
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
            label: "Supervision requests",
            to: "/clinical/mhp/supervision",
            icon: ShieldCheck,
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
      {
        label: "Inpatient & residential",
        icon: BedDouble,
        children: [
          { label: "Admissions", to: "/clinical/inpatient", icon: Building2 },
          { label: "Ward board", to: "/clinical/inpatient/ward", icon: BedDouble },
          { label: "Discharge planning", to: "/clinical/discharge", icon: DoorOpen },
        ],
      },
      {
        label: "Pharmacy & medication",
        icon: Pill,
        children: [
          { label: "Medication orders & review", to: "/clinical/pharmacy", icon: Pill },
          {
            label: "Medication administration",
            to: "/clinical/ipd/nursing",
            icon: ClipboardCheck,
          },
        ],
      },
      {
        label: "Laboratory",
        icon: FlaskConical,
        children: [{ label: "Laboratory records", to: "/clinical/lims", icon: FlaskConical }],
      },
      {
        label: "Appointments & follow-up",
        icon: CalendarClock,
        children: [
          { label: "Appointments", to: "/clinical/appointments", icon: CalendarClock },
          { label: "Follow-up", to: "/clinical/follow-up", icon: CalendarCheck },
        ],
      },
      {
        label: "Referrals",
        icon: Share2,
        children: [
          { label: "Referral worklist", to: "/clinical/referrals", icon: ListChecks },
          {
            label: "Referral documents",
            to: "/clinical/referrals/documents",
            icon: FileText,
          },
        ],
      },
      {
        label: "Reports & analytics",
        icon: BarChart3,
        children: [
          { label: "Operational overview", to: "/clinical/reports", icon: FileBarChart },
          { label: "NACADA report", to: "/clinical/mhp/nacada", icon: FileBarChart },
        ],
      },
      { label: "Documents", to: "/clinical/documents", icon: FileText, matchPrefix: true },
      { label: "Billing", to: "/clinical/billing", icon: CreditCard },
    ],
  },
];
