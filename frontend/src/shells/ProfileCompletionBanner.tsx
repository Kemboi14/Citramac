import { useEffect, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { AlertCircle, IdCard, X } from "lucide-react";
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
interface Reminder {
  tone: StatusTone;
  pill: string;
  text: string;
  blocking: boolean;
  link: string;
}

function useReminder(): Reminder | null {
  const { profile } = useAuth();
  const location = useLocation();
  const summary = profile?.professional_profile;
  if (!summary || location.pathname.endsWith("/profile")) return null;
  const shell = location.pathname.startsWith("/org-admin") ? "/org-admin" : "/clinical";
  const link = `${shell}/profile#professional-profile`;
  if (summary.signing_block) {
    return {
      tone: "danger",
      pill: "Licence expired",
      text: summary.signing_block,
      blocking: true,
      link,
    };
  }
  if (summary.status === "RETURNED") {
    return {
      tone: "warning",
      pill: "Returned",
      text: `Your professional profile was returned: ${summary.returned_reason}`,
      blocking: false,
      link,
    };
  }
  if (summary.licence_status === "EXPIRING") {
    return {
      tone: "warning",
      pill: "Expiring",
      text: "A practising licence expires soon. Add the renewed licence on your profile.",
      blocking: false,
      link,
    };
  }
  if (summary.needs_action) {
    return {
      tone: "warning",
      pill: "Action needed",
      text: summary.credentials_required
        ? "Complete your professional profile — registration, practising licences and qualifications, each with its document — and submit it for verification."
        : "Add your mobile phone number to your profile.",
      blocking: false,
      link,
    };
  }
  return null;
}

// Shown once per sign-in (per signed-in person, in memory for this tab only —
// never browser storage), then it fades away on its own.
const shownFor = new Set<string>();

/**
 * An expired practising licence — which blocks signing — stays on the page as a
 * banner that cannot be put away. Every other profile reminder pops up once
 * after signing in, in a corner, and fades away by itself after a few seconds
 * (or when closed), so it never pushes the clinical work down.
 */
export function ProfileCompletionBanner() {
  const reminder = useReminder();
  const { profile } = useAuth();
  const key = `${profile?.id ?? ""}:${reminder?.pill ?? ""}`;
  const [phase, setPhase] = useState<"hidden" | "in" | "out">("hidden");

  const eligible = Boolean(reminder && !reminder.blocking);
  // Shown for 10 s; hovering pauses it, so it never vanishes while being read.
  const [paused, setPaused] = useState(false);
  useEffect(() => {
    if (!eligible || shownFor.has(key)) return;
    shownFor.add(key);
    const show = window.setTimeout(() => setPhase("in"), 500);
    return () => window.clearTimeout(show);
  }, [key, eligible]);
  useEffect(() => {
    if (phase !== "in" || paused) return;
    const leave = window.setTimeout(() => setPhase("out"), 10000);
    return () => window.clearTimeout(leave);
  }, [phase, paused]);
  useEffect(() => {
    if (phase !== "out") return;
    const gone = window.setTimeout(() => setPhase("hidden"), 500);
    return () => window.clearTimeout(gone);
  }, [phase]);

  if (reminder?.blocking) {
    return (
      <div
        role="alert"
        className="mb-2 flex flex-wrap items-center gap-2 rounded-lg border border-surface-border bg-surface-card px-3 py-1 text-[12.5px] text-ink-900 shadow-sm"
      >
        <IdCard aria-hidden="true" className="h-4 w-4 flex-shrink-0 text-ink-500" />
        <span className="min-w-0 flex-1">
          {reminder.text}{" "}
          <Link to={reminder.link} className="font-semibold text-brand-green-dark underline">
            Open my profile
          </Link>
        </span>
        <StatusPill tone={reminder.tone}>{reminder.pill}</StatusPill>
      </div>
    );
  }
  if (!reminder || phase === "hidden") return null;
  const close = () => setPhase("out");
  const [title, detail] =
    reminder.pill === "Expiring"
      ? ["Licence expiring soon", "Add the renewed practising licence to your profile."]
      : reminder.pill === "Returned"
        ? [
            "Profile returned",
            reminder.text.replace(/^Your professional profile was returned: /, ""),
          ]
        : ["Profile incomplete", reminder.text];
  return (
    <div
      role="alert"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      className={`fixed right-5 top-[72px] z-40 w-[360px] max-w-[calc(100vw-2.5rem)] rounded-xl border border-priority-orange/25 bg-priority-orange-tint px-4 py-3 shadow-[0_10px_30px_rgba(16,34,29,.12)] transition-all duration-500 ease-out ${
        phase === "in" ? "translate-y-0 opacity-100" : "-translate-y-2 opacity-0"
      }`}
    >
      <div className="flex items-start gap-3">
        <span className="mt-0.5 grid h-5 w-5 flex-shrink-0 place-items-center rounded-full bg-priority-orange text-white">
          <AlertCircle aria-hidden="true" className="h-3.5 w-3.5" />
        </span>
        <div className="min-w-0 flex-1 text-priority-orange">
          <p className="text-[13px] font-semibold">{title}</p>
          <p className="text-[12.5px] opacity-90">
            {detail}{" "}
            <Link to={reminder.link} onClick={close} className="font-semibold underline">
              Open profile
            </Link>
          </p>
        </div>
        <button
          type="button"
          onClick={close}
          aria-label="Close"
          className="rounded p-0.5 text-priority-orange hover:bg-white/50"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}
