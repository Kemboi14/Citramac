import { useEffect, useRef, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { ArrowRightLeft, Building2, Check, ChevronDown, MapPin, Users } from "lucide-react";
import { useAuth } from "../auth/useAuth";
import { ALL_BRANCHES, setWorkingBranch } from "../lib/workingBranch";
import { useWorkingBranch } from "./useWorkingBranch";

const ADMIN_ROLES = new Set(["Org Admin", "Auditor"]);

function organizationInitials(name: string) {
  const words = name.trim().split(/\s+/).filter(Boolean);
  return (
    words
      .slice(0, 2)
      .map((word) => word[0])
      .join("") || "?"
  ).toUpperCase();
}

/**
 * Topbar "where am I" pill for every tenant user (Org Admin and Clinical
 * Workspace) — mockups/citramac_clinical_workspace.html's `.tenant-switch`:
 * organisation initials, then "Organisation · Branch", then a chevron that
 * opens the user's full context (organisation, role, department, every
 * branch they work at). Choosing a branch makes it the working branch
 * (lib/workingBranch.ts): records and roles narrow to it and new episodes,
 * appointments and encounters are filed under it. An organisation-wide
 * account can also choose "All branches". Someone holding both Org Admin and
 * a clinical role switches between the two shells from here too. Data comes
 * from `GET /me/profile/` (AuthContext.profile), which every role can read.
 */
export function OrgBranchPill() {
  const { profile, claims } = useAuth();
  const working = useWorkingBranch();
  const location = useLocation();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handleClick = (event: MouseEvent) => {
      if (!ref.current?.contains(event.target as Node)) setOpen(false);
    };
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", handleClick);
    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("mousedown", handleClick);
      document.removeEventListener("keydown", handleKey);
    };
  }, [open]);

  if (!profile) {
    return (
      <div
        aria-hidden
        className="flex h-9 w-44 animate-pulse items-center gap-2 rounded-full border border-surface-border bg-surface-card px-3"
      >
        <span className="h-6 w-6 rounded-md bg-surface-bg" />
        <span className="h-2.5 flex-1 rounded bg-surface-bg" />
      </div>
    );
  }

  const organizationName = profile.organization_name ?? "No organisation";
  // What the server works with when nothing was chosen: the primary branch,
  // else the only branch (backend apps/accounts/access.py).
  const defaultBranch =
    profile.branches.find((b) => b.is_primary) ??
    (profile.branches.length === 1 ? profile.branches[0] : undefined);
  const workingBranch =
    working === ALL_BRANCHES
      ? undefined
      : (profile.branches.find((b) => b.id === working) ?? (working ? undefined : defaultBranch));
  const branchName =
    working === ALL_BRANCHES || (!workingBranch && profile.all_branches)
      ? "All branches"
      : (workingBranch?.name ?? (profile.branches.length ? "Choose a branch" : "No branch assigned"));
  const roles = profile.role_names.length ? profile.role_names : claims?.role ? [claims.role] : [];
  const canSwitch = profile.branches.length > 1 || profile.all_branches;
  const inOrgAdmin = location.pathname.startsWith("/org-admin");
  const holdsOrgAdmin = roles.includes("Org Admin");
  const holdsClinical = roles.some((role) => !ADMIN_ROLES.has(role));
  const otherShell = inOrgAdmin
    ? holdsClinical
      ? { to: "/clinical", label: "Open the Clinical Workspace" }
      : null
    : holdsOrgAdmin
      ? { to: "/org-admin", label: "Open the Org Admin console" }
      : null;

  const choose = (branchId: string) => {
    setWorkingBranch(branchId);
    setOpen(false);
  };

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={`${organizationName}, ${branchName}`}
        onClick={() => setOpen((v) => !v)}
        className="flex max-w-[22rem] items-center gap-2 rounded-full border border-surface-border bg-surface-card px-2 py-1.5 text-[12.5px] font-medium text-ink-700 transition-colors duration-150 hover:bg-surface-bg min-[1060px]:px-3"
      >
        <span className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-md bg-brand-green-tint text-[10px] font-bold text-brand-green-dark">
          {organizationInitials(organizationName)}
        </span>
        <span className="hidden truncate min-[1060px]:inline">
          {organizationName}
          <span className="text-ink-400"> · </span>
          <span className={workingBranch || profile.all_branches ? "" : "text-ink-400"}>
            {branchName}
          </span>
        </span>
        <ChevronDown
          className={`h-3.5 w-3.5 flex-shrink-0 text-ink-400 transition-transform duration-150 ${open ? "rotate-180" : ""}`}
        />
      </button>

      {open && (
        <div
          role="dialog"
          aria-label="Your organisation and branch"
          className="absolute right-0 top-11 z-30 w-72 max-w-[calc(100vw-2rem)] animate-scale-in overflow-hidden rounded-[10px] border border-surface-border bg-surface-card shadow-md"
        >
          <div className="flex items-start gap-2.5 border-b border-surface-border px-3.5 py-3">
            <Building2 className="mt-0.5 h-4 w-4 flex-shrink-0 text-brand-green" />
            <div className="min-w-0">
              <p className="text-[10.5px] font-semibold uppercase tracking-wide text-ink-400">
                Organisation
              </p>
              <p className="truncate text-[13px] font-semibold text-ink-900">{organizationName}</p>
              {roles.length > 0 && (
                <p className="truncate text-[11.5px] text-ink-500">{roles.join(", ")}</p>
              )}
            </div>
          </div>

          <div className="border-b border-surface-border px-3.5 py-3">
            <p className="mb-1.5 flex items-center gap-1.5 text-[10.5px] font-semibold uppercase tracking-wide text-ink-400">
              <MapPin className="h-3.5 w-3.5" />
              {canSwitch ? "Working at" : "Branch"}
            </p>
            {profile.branches.length === 0 ? (
              <p className="text-[12.5px] text-ink-500">
                You haven&apos;t been assigned to a branch. Ask your Org Admin to add you to one.
              </p>
            ) : (
              <ul className="space-y-0.5">
                {profile.all_branches && profile.branches.length > 1 && (
                  <BranchOption
                    label="All branches"
                    detail="Every branch's records"
                    selected={branchName === "All branches"}
                    onSelect={() => choose(ALL_BRANCHES)}
                    disabled={!canSwitch}
                  />
                )}
                {profile.branches.map((branch) => (
                  <BranchOption
                    key={branch.id}
                    label={branch.name}
                    detail={branch.roles.join(", ")}
                    primary={branch.is_primary}
                    selected={workingBranch?.id === branch.id}
                    onSelect={() => choose(branch.id)}
                    disabled={!canSwitch}
                  />
                ))}
              </ul>
            )}
          </div>

          {otherShell && (
            <Link
              to={otherShell.to}
              onClick={() => setOpen(false)}
              className="flex items-center gap-2 border-b border-surface-border px-3.5 py-2.5 text-[12.5px] font-semibold text-brand-green hover:bg-surface-bg"
            >
              <ArrowRightLeft className="h-4 w-4" />
              {otherShell.label}
            </Link>
          )}

          <div className="flex items-start gap-2.5 px-3.5 py-3">
            <Users className="mt-0.5 h-4 w-4 flex-shrink-0 text-ink-400" />
            <div className="min-w-0">
              <p className="text-[10.5px] font-semibold uppercase tracking-wide text-ink-400">
                Department
              </p>
              <p className="truncate text-[12.5px] text-ink-900">
                {profile.department_name ?? "Not assigned"}
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function BranchOption({
  label,
  detail,
  primary = false,
  selected,
  onSelect,
  disabled,
}: {
  label: string;
  detail?: string;
  primary?: boolean;
  selected: boolean;
  onSelect: () => void;
  disabled: boolean;
}) {
  return (
    <li>
      <button
        type="button"
        onClick={onSelect}
        disabled={disabled}
        aria-pressed={selected}
        className={`flex w-full items-center justify-between gap-2 rounded-md px-2 py-1.5 text-left text-[12.5px] transition-colors duration-150 disabled:cursor-default ${
          selected ? "bg-brand-green-tint text-brand-green-dark" : "text-ink-900 hover:bg-surface-bg"
        }`}
      >
        <span className="min-w-0">
          <span className="block truncate font-medium">{label}</span>
          {detail && <span className="block truncate text-[11px] text-ink-500">{detail}</span>}
        </span>
        <span className="flex flex-shrink-0 items-center gap-1">
          {primary && (
            <span className="rounded-full bg-surface-bg px-2 py-0.5 text-[10px] font-semibold text-ink-500">
              Primary
            </span>
          )}
          {selected && <Check className="h-3.5 w-3.5" />}
        </span>
      </button>
    </li>
  );
}
