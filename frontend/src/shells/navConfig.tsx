import {
  Activity,
  Building2,
  ClipboardList,
  CreditCard,
  FileBarChart,
  FileText,
  FlaskConical,
  Info,
  Landmark,
  LayoutDashboard,
  Paperclip,
  Pill,
  Settings,
  ShieldCheck,
  Stethoscope,
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
    ],
  },
  {
    label: "Governance",
    items: [
      { label: "Roles & Permissions", to: "/super-admin/roles", icon: ShieldCheck },
      { label: "Audit Log", to: "/super-admin/audit-log", icon: ClipboardList },
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
];

// Matches mockups/citramac_clinical_workspace.html — docs/03-DESIGN-SYSTEM.md §3.5.
export const CLINICAL_NAV: NavGroup[] = [
  {
    label: "Core Clinical (DHA)",
    items: [
      { label: "Client Registry", to: "/clinical", icon: FileText },
      { label: "Attachments", to: "/clinical/attachments", icon: Paperclip },
      { label: "Triage & MSE", to: "/clinical/triage", icon: Activity },
      { label: "Clinical Review", to: "/clinical/review", icon: Stethoscope },
      { label: "Clinical Encounter", to: "/clinical/encounter", icon: FileText },
      { label: "Laboratory (LIMS)", to: "/clinical/lims", icon: FlaskConical, soon: true },
      { label: "Pharmacy", to: "/clinical/pharmacy", icon: Pill, soon: true },
      { label: "Inpatient & Ward", to: "/clinical/ipd", icon: Building2, soon: true },
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
        soon: true,
      },
      { label: "NACADA NDO Report", to: "/clinical/ccp/nacada", icon: FileBarChart },
      { label: "CCP Team", to: "/clinical/ccp/team", icon: UserCog, soon: true },
    ],
  },
  {
    label: "",
    items: [{ label: "About", to: "/clinical/about", icon: Info, soon: true }],
  },
];
