import { AlertTriangle, Check } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  PRIORITY_LABEL,
  type ClientBanner,
  type Priority,
  type PriorityOrBlank,
} from "../../../lib/carePathwayApi";
import { ErrorNote } from "./ui";
import { countdownText, useNow } from "../record/legal/countdown";
import type { LegalBanner } from "../../../lib/legalStatusApi";

const SEX_SHORT: Record<string, string> = { FEMALE: "F", MALE: "M", OTHER: "Intersex / other" };

const PRIORITY_SOLID: Record<Priority, string> = {
  RED: "bg-priority-red-solid",
  ORANGE: "bg-priority-orange-solid",
  YELLOW: "bg-priority-yellow-solid",
  GREEN: "bg-priority-green-solid",
};

export interface BannerOverrides {
  /** Live allergy preview while triage edits it (doc 15 §1.6 section A). */
  allergy?: ClientBanner["allergy"];
  priority?: PriorityOrBlank;
  status?: string;
}

/** How many allergy / alert chips the banner shows before "+N more". */
const SHOWN = 2;

/**
 * Persistent client safety banner — docs/15-CLINICAL-WORKSPACE-V3.md §1.2.
 * Four cells: identity, allergy (known / none / unknown), setting + triage
 * priority, critical alerts + responsible clinician / team. Sticky at the top
 * of the content area.
 *
 * Its height is fixed (QA 2026-10-30, client mockup "client banner"): chips stay
 * on one line, the first two allergies and alerts (most severe first, server
 * order) are shown, and the rest open in a popover from "+N more" — so a client
 * with many alerts no longer pushes the page down.
 */
export function SafetyBanner({
  banner,
  error,
  overrides,
  actions,
}: {
  banner: ClientBanner | null;
  error?: string | null;
  overrides?: BannerOverrides;
  /** Small links under the client's name (e.g. edit details), so they take no row of their own. */
  actions?: ReactNode;
}) {
  const collapsed = useScrolledDown();
  if (error) return <ErrorNote>{error}</ErrorNote>;
  if (!banner) {
    return (
      <div className="mb-3 h-[72px] animate-pulse rounded-lg border border-surface-border bg-surface-card" />
    );
  }
  const name = banner.name.trim() || "Temporary client (unnamed)";
  const initials =
    name
      .split(/\s+/)
      .filter(Boolean)
      .map((word) => word[0])
      .join("")
      .slice(0, 2)
      .toUpperCase() || "—";
  const temporary = banner.identity_status !== "IDENTIFIED";
  const allergy = overrides?.allergy ?? banner.allergy;
  const priority = overrides?.priority ?? banner.priority;
  const status = overrides?.status ?? banner.setting.status;
  const inpatient = banner.setting.type === "INPATIENT";
  const setting = inpatient
    ? `${banner.setting.ward ?? "Inpatient"}${banner.setting.bed ? ` · Bed ${banner.setting.bed}` : ""}${status ? ` · ${status}` : ""}`
    : `Outpatient${status ? ` · ${status}` : ""}`;
  const demographics = [
    banner.age !== null && banner.age !== undefined ? `${banner.age} yrs` : "",
    SEX_SHORT[banner.sex] ?? "",
    banner.date_of_birth ? `DOB ${banner.date_of_birth}` : "",
    banner.payer && banner.payer !== "Unknown" ? banner.payer : "",
  ].filter(Boolean);

  const allergyBox = {
    known: "border-[#e5372b] bg-priority-red-tint",
    none: "border-priority-green bg-priority-green-tint",
    unknown:
      "border-priority-orange bg-[repeating-linear-gradient(135deg,var(--pri-orange-tint)_0_10px,var(--card)_10px_20px)]",
  }[allergy.state];
  const allergyTitle = {
    known: "Known allergies",
    none: "No known allergies",
    unknown: "Allergies unknown",
  }[allergy.state];
  const allergyTone = {
    known: "text-priority-red",
    none: "text-priority-green",
    unknown: "text-priority-orange",
  }[allergy.state];

  // Compact: the banner is read at a glance above every clinical screen, so it
  // keeps every safety item but takes as little height as it can.
  const label = "mb-0.5 text-[11px] font-semibold text-ink-400";
  const cell = "min-w-0 px-4 py-2";

  if (collapsed) {
    // Scrolled into the page: one slim line that still carries every safety item.
    return (
      <section
        aria-label="Patient safety banner"
        data-safety-banner
        data-collapsed
        className="sticky top-[var(--app-header-h,0px)] z-[15] -mx-4 mb-3 border-b border-surface-border bg-surface-card font-system shadow-[0_12px_24px_-18px_rgba(15,27,45,.35)] sm:-mx-6 lg:-mx-8 [&_*]:font-system"
      >
        <div className="mx-auto flex max-w-[1360px] flex-wrap items-center gap-x-4 gap-y-1 px-4 py-1.5 text-[12.5px]">
          <span className="flex min-w-0 items-center gap-2">
            <span className="truncate text-[14px] font-extrabold text-ink-900">{name}</span>
            <span className="whitespace-nowrap text-[11px] font-bold tabular-nums text-brand-green">
              {banner.citramac_number || "No ID"}
            </span>
            {demographics.length > 0 && (
              <span className="hidden whitespace-nowrap text-ink-500 md:inline">
                {demographics.slice(0, 2).join(" · ")}
              </span>
            )}
          </span>
          <span
            className={`inline-flex items-center gap-1 whitespace-nowrap rounded-md border px-2 py-px text-[11.5px] font-extrabold ${allergyBox} ${allergyTone}`}
            title={allergy.items.map((item) => item.substance).join(", ") || allergyTitle}
          >
            {allergy.state === "none" ? (
              <Check className="h-3.5 w-3.5" />
            ) : (
              <AlertTriangle className="h-3.5 w-3.5" />
            )}
            {allergy.state === "known" && allergy.items.length > 0
              ? `Allergies: ${allergy.items.map((item) => item.substance).join(", ")}`
              : allergyTitle}
          </span>
          {priority ? (
            <span
              className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-md px-2 py-px text-[11.5px] font-extrabold text-on-status ${PRIORITY_SOLID[priority]}`}
            >
              {priority} · {PRIORITY_LABEL[priority]}
            </span>
          ) : null}
          {banner.alerts.length > 0 && (
            <span
              className="inline-flex items-center gap-1 whitespace-nowrap rounded-md border border-priority-orange/40 bg-priority-orange-tint px-2 py-px text-[11.5px] font-bold text-priority-orange"
              title={banner.alerts.map((alert) => alert.label).join("\n")}
            >
              <AlertTriangle className="h-3.5 w-3.5" />
              {banner.alerts.length} {banner.alerts.length === 1 ? "alert" : "alerts"}
            </span>
          )}
          <span className="min-w-0 truncate font-semibold text-ink-700" title={setting}>
            {setting}
            {banner.legal_status ? ` · ${banner.legal_status.label}` : ""}
          </span>
        </div>
      </section>
    );
  }

  return (
    <section
      aria-label="Patient safety banner"
      data-safety-banner
      className="sticky top-[var(--app-header-h,0px)] z-[15] -mx-4 mb-3 border-b font-system [&_*]:font-system border-surface-border bg-surface-card shadow-[0_20px_40px_-24px_rgba(15,27,45,.28)] sm:-mx-6 lg:-mx-8"
    >
      <div className="mx-auto grid max-w-[1360px] grid-cols-1 sm:grid-cols-2 xl:grid-cols-[minmax(240px,1.2fr)_minmax(200px,.9fr)_minmax(220px,1.1fr)_minmax(240px,1.3fr)] [&>*+*]:border-t [&>*+*]:border-surface-border sm:[&>*+*]:border-t-0 xl:[&>*+*]:border-l">
        <div className={`${cell} flex items-center gap-3.5`} aria-label="Patient identity">
          <div
            aria-hidden="true"
            className={`grid h-9 w-9 flex-shrink-0 place-items-center rounded-xl text-[13px] font-extrabold ${
              temporary
                ? "bg-surface-bg text-ink-500 ring-1 ring-surface-border"
                : "bg-brand-green-tint text-brand-green-dark ring-1 ring-brand-green/30"
            }`}
          >
            {initials}
          </div>
          <div className="min-w-0">
            <div className="line-clamp-1 break-words text-[16px] font-extrabold leading-tight tracking-[-.2px] text-ink-900">
              {name}{" "}
              {banner.identity_label && (
                <span className="ml-1 inline-block rounded-md border border-priority-orange/40 bg-priority-orange-tint px-[7px] py-px align-[3px] text-[10px] font-semibold text-priority-orange">
                  {banner.identity_label}
                </span>
              )}
            </div>
            <div className="mt-0.5 flex flex-wrap gap-x-[7px] gap-y-0 text-[11px] font-bold tabular-nums text-brand-green">
              <span>CITRAMAC ID {banner.citramac_number || "Not recorded"}</span>
              <span className="text-ink-400">·</span>
              <span>MRN {banner.mrn || "Not recorded"}</span>
            </div>
            {demographics.length > 0 && (
              <div
                className="mt-0.5 truncate text-[12px] text-ink-500"
                title={demographics.join(" · ")}
              >
                {demographics.join(" · ")}
              </div>
            )}
            {actions && (
              <div className="mt-0.5 flex flex-wrap gap-x-3 text-[11.5px] font-semibold text-brand-green [&>*:hover]:underline">
                {actions}
              </div>
            )}
          </div>
        </div>

        {/* Same shape as the other columns: a label, then the status in its
            colour with an icon, and the detail beneath — no box. */}
        <div className={`${cell} flex flex-col justify-center`} aria-label="Allergy information">
          <div className={label}>Allergies</div>
          <div
            id="banner-allergy"
            aria-live="polite"
            data-state={allergy.state}
            className="flex w-full flex-col gap-0.5"
          >
            <div className={`flex items-center gap-1.5 text-[13px] font-bold ${allergyTone}`}>
              {allergy.state === "none" ? (
                <Check className="h-[15px] w-[15px]" />
              ) : (
                <AlertTriangle className="h-[15px] w-[15px]" />
              )}
              {allergyTitle}
            </div>
            <div className="flex min-w-0 items-center gap-1.5">
              {allergy.items.length > 0 ? (
                <ChipOverflow
                  title="All allergies"
                  items={allergy.items.map((item) => ({
                    key: item.substance,
                    text: item.substance,
                    chip: (
                      <span
                        title={
                          item.verification_status === "UNCONFIRMED"
                            ? `${item.substance} — client-reported, not yet confirmed by a clinician`
                            : item.substance
                        }
                        className="inline-flex min-w-0 max-w-full items-center gap-1 rounded-lg border border-priority-red/40 bg-surface-card px-[9px] py-[3px] text-xs font-bold text-ink-900"
                      >
                        <span className="truncate">{item.substance}</span>
                        {item.verification_status === "UNCONFIRMED" && (
                          <span className="flex-none text-[10px] font-semibold text-ink-500">
                            (reported)
                          </span>
                        )}
                      </span>
                    ),
                  }))}
                />
              ) : (
                <span className="text-[12px] font-semibold text-ink-500">
                  {allergy.state === "none"
                    ? "Confirmed at triage"
                    : allergy.state === "known"
                      ? "Details not recorded"
                      : "Confirm at triage"}
                </span>
              )}
            </div>
          </div>
        </div>

        <div
          className={`${cell} flex flex-col gap-1.5`}
          aria-label="Current setting and triage priority"
        >
          <div>
            <div className={label}>Current setting</div>
            <div className="flex items-start gap-2 break-words text-[13px] font-bold leading-snug text-ink-900">
              <span
                aria-hidden="true"
                className={`mt-[5px] h-2 w-2 flex-none rounded-full ${
                  inpatient
                    ? "bg-priority-green-solid shadow-[0_0_0_4px_var(--pri-green-tint)]"
                    : "bg-brand-green shadow-[0_0_0_4px_var(--green-tint)]"
                }`}
              />
              <span>{setting}</span>
            </div>
            {banner.legal_status && (
              <LegalBannerLine legal={banner.legal_status} inpatient={inpatient} />
            )}
          </div>
          <div>
            <div className={label}>Triage / risk priority</div>
            {priority ? (
              <span
                className={`inline-flex w-fit items-center gap-2 rounded-lg py-[3px] pl-[7px] pr-2.5 text-[12px] font-extrabold text-on-status ${PRIORITY_SOLID[priority]}`}
              >
                <span className="h-2 w-2 flex-none rounded-full bg-white/90 shadow-[0_0_0_4px_rgba(255,255,255,.16)]" />
                {priority} · {PRIORITY_LABEL[priority]}
              </span>
            ) : (
              <span className="inline-flex rounded-[9px] bg-surface-bg px-2.5 py-[5px] text-xs font-semibold text-ink-700">
                Assigned after triage
              </span>
            )}
          </div>
        </div>

        <div className={`${cell} flex flex-col gap-1.5`} aria-label="Clinical alerts and care team">
          <div>
            <div className={`${label} flex items-center gap-2`}>
              Critical clinical alerts
              {banner.alerts.length > 0 && (
                <span className="rounded-full bg-priority-red-solid px-2 py-px text-[11px] font-bold text-on-status">
                  {banner.alerts.length}
                </span>
              )}
            </div>
            {banner.alerts.length > 0 ? (
              <ChipOverflow
                title="All critical alerts"
                items={banner.alerts.map((alert) => ({
                  key: alert.id,
                  text: alert.label,
                  chip: (
                    <span
                      title={alert.label}
                      className="inline-flex min-w-0 max-w-full items-center gap-1.5 rounded-[9px] border border-priority-orange/40 bg-priority-orange-tint px-2.5 py-1 text-xs font-bold text-priority-orange"
                    >
                      <AlertTriangle className="h-[15px] w-[15px] flex-none" />
                      <span className="truncate">{alert.label}</span>
                    </span>
                  ),
                }))}
              />
            ) : (
              <span className="text-xs font-semibold text-ink-400">No critical alerts</span>
            )}
          </div>
          <div>
            <div className={`${label} flex items-center gap-2`}>
              Responsible clinician / team
              {banner.open_tasks > 0 && (
                <span className="rounded-full bg-surface-bg px-2 py-px text-[11px] font-bold text-ink-700 ring-1 ring-surface-border">
                  {banner.open_tasks} open {banner.open_tasks === 1 ? "task" : "tasks"}
                </span>
              )}
            </div>
            <div className="min-w-0 text-sm leading-snug">
              <div
                className={`truncate font-bold ${banner.clinician === "Unassigned" ? "text-ink-400" : "text-ink-900"}`}
                title={
                  banner.clinician_role
                    ? `${banner.clinician} — ${banner.clinician_role}`
                    : banner.clinician
                }
              >
                {banner.clinician}
                {banner.clinician_role && (
                  <span className="ml-1.5 text-xs font-semibold text-ink-400">
                    {banner.clinician_role}
                  </span>
                )}
              </div>
              {banner.team ? (
                <div
                  className="truncate text-xs font-semibold text-ink-500"
                  title={
                    banner.care_team.length > 0
                      ? banner.care_team.map((m) => `${m.name} (${m.role_label})`).join("\n")
                      : banner.team
                  }
                >
                  {banner.team}
                </div>
              ) : (
                <div className="text-xs font-semibold text-ink-400">No care team assigned</div>
              )}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

interface OverflowItem {
  key: string;
  text: string;
  chip: ReactNode;
}

/** One line of chips — the first SHOWN, then "+N more" opening every item in a
 * popover (closed by Escape, a click outside, or the button again). */
function ChipOverflow({ title, items }: { title: string; items: OverflowItem[] }) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const rest = items.length - SHOWN;

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={box} className="relative flex min-w-0 items-center gap-1.5">
      {items.slice(0, SHOWN).map((item) => (
        <span key={item.key} className="flex min-w-0">
          {item.chip}
        </span>
      ))}
      {rest > 0 && (
        <button
          type="button"
          aria-expanded={open}
          aria-label={`${title}: ${rest} more`}
          onClick={() => setOpen((v) => !v)}
          className="flex-none whitespace-nowrap rounded-full border border-surface-border bg-surface-card px-2.5 py-1 text-xs font-semibold text-ink-900 hover:bg-surface-bg aria-expanded:bg-surface-bg"
        >
          +{rest} more
        </button>
      )}
      {open && (
        <div
          role="dialog"
          aria-label={title}
          className="absolute right-0 top-full z-30 mt-2 max-h-[340px] w-[min(340px,calc(100vw-32px))] overflow-auto rounded-[14px] border border-surface-border bg-surface-card p-3.5 shadow-[0_12px_32px_rgba(16,34,29,.16)]"
        >
          <div className="mb-3 text-[11.5px] font-semibold uppercase tracking-[.07em] text-ink-500">
            {title} ({items.length})
          </div>
          <ul className="flex flex-wrap gap-2">
            {items.map((item) => (
              <li key={item.key} className="flex min-w-0 max-w-full">
                {item.chip}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

/** BAN-10 / LGL-DATA-01: "INPATIENT — INVOLUNTARY, expires …" plus a live notice
 * countdown — always as text, never colour alone. */
function LegalBannerLine({ legal, inpatient }: { legal: LegalBanner; inpatient: boolean }) {
  const now = useNow();
  return (
    <div aria-label="Legal admission status" className="mt-0.5 flex flex-col gap-0">
      <span className="text-[11px] font-extrabold tracking-[.2px] text-ink-900">
        {inpatient ? "INPATIENT — " : ""}
        {legal.label}
      </span>
      {legal.notice && (
        <span className="text-xs font-bold text-priority-orange">
          {legal.notice.notice_period_hours}-h discharge notice:{" "}
          {countdownText(legal.notice.earliest_departure_at, now)}
        </span>
      )}
    </div>
  );
}

/** True once the page is scrolled well down, false again near the top. Two
 * thresholds, so the banner's own change in height never makes it flicker. */
function useScrolledDown() {
  const [down, setDown] = useState(false);
  useEffect(() => {
    const main = document.getElementById("main-content");
    const offset = () => Math.max(window.scrollY, main?.scrollTop ?? 0);
    const onScroll = () => setDown((was) => (was ? offset() > 16 : offset() > 120));
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    main?.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", onScroll);
      main?.removeEventListener("scroll", onScroll);
    };
  }, []);
  return down;
}
