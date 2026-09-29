import { useEffect, useRef, useState } from "react";
import { Building2, Check, ChevronDown, MapPin, Users } from "lucide-react";
import { useAuth } from "../auth/useAuth";

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
 * branch they have access to). Read-only: the backend has no "active
 * branch" to switch to, so this shows the primary branch rather than
 * pretending to change anything. Data comes from `GET /me/profile/`
 * (AuthContext.profile), which every role can read — unlike
 * /platform/branches/, which is admin-only.
 */
export function OrgBranchPill() {
  const { profile, claims } = useAuth();
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
  const branchName = profile.primary_branch?.name ?? "No branch assigned";
  const roles = profile.role_names.length ? profile.role_names : claims?.role ? [claims.role] : [];

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
          <span className={profile.primary_branch ? "" : "text-ink-400"}>{branchName}</span>
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
              {profile.branches.length === 1 ? "Branch" : "Branches"}
            </p>
            {profile.branches.length === 0 ? (
              <p className="text-[12.5px] text-ink-500">
                You haven&apos;t been assigned to a branch. Ask your Org Admin to add you to one.
              </p>
            ) : (
              <ul className="space-y-1">
                {profile.branches.map((branch) => (
                  <li
                    key={branch.id}
                    className="flex items-center justify-between gap-2 text-[12.5px] text-ink-900"
                  >
                    <span className="truncate">{branch.name}</span>
                    {branch.is_primary && (
                      <span className="flex flex-shrink-0 items-center gap-1 rounded-full bg-brand-green-tint px-2 py-0.5 text-[10px] font-semibold text-brand-green-dark">
                        <Check className="h-3 w-3" />
                        Primary
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>

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
