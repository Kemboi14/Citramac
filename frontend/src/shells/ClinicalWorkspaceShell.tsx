import { ChevronDown } from "lucide-react";
import { useAuth } from "../auth/useAuth";
import { AppShell } from "./AppShell";
import { CLINICAL_NAV } from "./navConfig";
import { TopbarActions } from "./TopbarActions";
import { initialsAndLabel } from "./userDisplay";

/** docs/03-DESIGN-SYSTEM.md §3.5 — mockups/citramac_clinical_workspace.html. */
export function ClinicalWorkspaceShell() {
  const { claims } = useAuth();
  const { initials, name } = initialsAndLabel(claims);

  return (
    <AppShell
      brandName="CITRAMAC"
      brandSub="Clinical Workspace"
      navGroups={CLINICAL_NAV}
      userInitials={initials}
      userName={name}
      userRole={claims?.role.replace(/_/g, " ") || "Clinician"}
      searchPlaceholder="Search clients by name or UHID…"
      topbarRight={
        <TopbarActions
          pill={
            <button
              type="button"
              className="flex items-center gap-2 rounded-full border border-surface-border bg-white px-3 py-1.5 text-[12.5px] font-medium text-ink-700"
            >
              <span className="flex h-6 w-6 items-center justify-center rounded-md bg-brand-green-tint text-[10px] font-bold text-brand-green-dark">
                {initials}
              </span>
              Your Branch
              <ChevronDown className="h-3.5 w-3.5 text-ink-400" />
            </button>
          }
        />
      }
    />
  );
}
