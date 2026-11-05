import { useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { IdCard, X } from "lucide-react";
import { useAuth } from "../auth/useAuth";
import { StatusPill, type StatusTone } from "../modules/care/shared/ui";

/**
 * "Complete your professional profile" — shown across the app to organisation
 * staff while their profile has something outstanding (owner decision
 * 2026-11-05), read from the profile AuthContext already holds. It can be put
 * away for the rest of the visit, never for good; an expired licence (which
 * blocks signing) can't be put away at all. Not shown on the profile page
 * itself.
 */
export function ProfileCompletionBanner() {
  const { profile } = useAuth();
  const location = useLocation();
  const [dismissed, setDismissed] = useState(false);
  const summary = profile?.professional_profile;
  if (!summary || location.pathname.endsWith("/profile")) return null;

  const shell = location.pathname.startsWith("/org-admin") ? "/org-admin" : "/clinical";
  const link = `${shell}/profile#professional-profile`;

  let tone: StatusTone = "warning";
  let pill = "Action needed";
  let text: string;
  if (summary.signing_block) {
    tone = "danger";
    pill = "Licence expired";
    text = summary.signing_block;
  } else if (summary.status === "RETURNED") {
    pill = "Returned";
    text = `Your professional profile was returned: ${summary.returned_reason}`;
  } else if (summary.licence_status === "EXPIRING") {
    pill = "Expiring";
    text = "Your practising licence expires soon. Record the renewal on your profile.";
  } else if (summary.needs_action) {
    text = summary.credentials_required
      ? "Complete your professional profile — registration, practising licence, qualifications and documents — and submit it for verification."
      : "Add your mobile phone number to your profile.";
  } else {
    return null;
  }
  const blocking = Boolean(summary.signing_block);
  if (dismissed && !blocking) return null;

  return (
    <div
      role={blocking ? "alert" : "status"}
      className="mb-4 flex flex-wrap items-center gap-2.5 rounded-xl border border-surface-border bg-surface-card px-3.5 py-2.5 text-[13px] text-ink-900 shadow-sm"
    >
      <IdCard aria-hidden="true" className="h-4 w-4 flex-shrink-0 text-ink-500" />
      <span className="min-w-0 flex-1">
        {text}{" "}
        <Link to={link} className="font-semibold text-brand-green-dark underline">
          Open my profile
        </Link>
      </span>
      <StatusPill tone={tone}>{pill}</StatusPill>
      {!blocking && (
        <button
          type="button"
          onClick={() => setDismissed(true)}
          aria-label="Hide until next visit"
          className="rounded p-0.5 text-ink-500 hover:bg-surface-bg"
        >
          <X className="h-4 w-4" />
        </button>
      )}
    </div>
  );
}
