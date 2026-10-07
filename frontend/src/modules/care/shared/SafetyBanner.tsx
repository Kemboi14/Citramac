import { AlertTriangle, Check } from "lucide-react";
import {
  PRIORITY_LABEL,
  type ClientBanner,
  type Priority,
  type PriorityOrBlank,
} from "../../../lib/carePathwayApi";
import { ErrorNote } from "./ui";

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

/**
 * Persistent client safety banner — docs/15-CLINICAL-WORKSPACE-V3.md §1.2.
 * Four cells: identity, allergy (known / none / unknown), setting + triage
 * priority, critical alerts + responsible clinician / team. Sticky at the top
 * of the content area.
 */
export function SafetyBanner({
  banner,
  error,
  overrides,
}: {
  banner: ClientBanner | null;
  error?: string | null;
  overrides?: BannerOverrides;
}) {
  if (error) return <ErrorNote>{error}</ErrorNote>;
  if (!banner) {
    return (
      <div className="mb-4 h-[104px] animate-pulse rounded-lg border border-surface-border bg-surface-card" />
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
    known: "ALLERGIES",
    none: "No known allergies",
    unknown: "ALLERGIES UNKNOWN",
  }[allergy.state];
  const allergyTone = {
    known: "text-priority-red",
    none: "text-priority-green",
    unknown: "text-priority-orange",
  }[allergy.state];

  const label = "mb-[7px] text-[11.5px] font-semibold text-ink-400";
  const cell = "min-w-0 px-5 py-3.5";

  return (
    <section
      aria-label="Patient safety banner"
      className="sticky top-0 z-[15] -mx-4 mb-4 border-b border-surface-border bg-surface-card shadow-[0_20px_40px_-24px_rgba(15,27,45,.28)] sm:-mx-6 lg:-mx-8"
    >
      <div className="mx-auto grid max-w-[1360px] grid-cols-1 sm:grid-cols-2 xl:grid-cols-[minmax(250px,1.1fr)_minmax(300px,1.8fr)_minmax(200px,.9fr)_minmax(210px,1fr)] [&>*+*]:border-t [&>*+*]:border-surface-border sm:[&>*+*]:border-t-0 xl:[&>*+*]:border-l">
        <div className={`${cell} flex items-center gap-3.5`} aria-label="Patient identity">
          <div
            aria-hidden="true"
            className={`grid h-12 w-12 flex-shrink-0 place-items-center rounded-[15px] text-base font-extrabold ${
              temporary
                ? "bg-surface-bg text-ink-500 ring-1 ring-surface-border"
                : "bg-brand-green-tint text-brand-green-dark ring-1 ring-brand-green/30"
            }`}
          >
            {initials}
          </div>
          <div className="min-w-0">
            <div className="break-words font-display text-xl font-extrabold leading-tight tracking-[-.4px] text-ink-900">
              {name}{" "}
              {banner.identity_label && (
                <span className="ml-1 inline-block rounded-md border border-priority-orange/40 bg-priority-orange-tint px-[7px] py-px align-[3px] text-[10px] font-semibold text-priority-orange">
                  {banner.identity_label}
                </span>
              )}
            </div>
            <div className="mt-1 flex flex-wrap gap-x-[7px] gap-y-0.5 font-mono text-[11px] font-bold text-brand-green">
              <span>CITRAMAC ID {banner.citramac_number || "Not recorded"}</span>
              <span className="text-ink-400">·</span>
              <span>MRN {banner.mrn || "Not recorded"}</span>
            </div>
            {demographics.length > 0 && (
              <div className="mt-[9px] flex flex-wrap gap-1.5">
                {demographics.map((item) => (
                  <span
                    key={item}
                    className="inline-flex min-h-[25px] items-center rounded-full border border-surface-border bg-surface-bg px-2.5 py-[3px] text-[11.5px] font-semibold text-ink-700"
                  >
                    {item}
                  </span>
                ))}
              </div>
            )}
          </div>
        </div>

        <div className={`${cell} flex items-center`} aria-label="Allergy information">
          <div
            id="banner-allergy"
            aria-live="polite"
            data-state={allergy.state}
            className={`flex w-full flex-col gap-2 rounded-[14px] border px-[15px] py-3 ${allergyBox}`}
          >
            <div
              className={`flex items-center gap-2 text-xs font-extrabold tracking-[.3px] ${allergyTone}`}
            >
              {allergy.state === "none" ? (
                <Check className="h-[15px] w-[15px]" />
              ) : (
                <AlertTriangle className="h-[15px] w-[15px]" />
              )}
              {allergyTitle}
            </div>
            <div className="flex flex-wrap gap-1.5">
              {allergy.items.length > 0 ? (
                allergy.items.map((item) => (
                  <span
                    key={item.substance}
                    title={
                      item.verification_status === "UNCONFIRMED"
                        ? "Client-reported — not yet confirmed by a clinician"
                        : undefined
                    }
                    className="inline-flex max-w-full items-center gap-1 break-words rounded-lg border border-priority-red/40 bg-surface-card px-[9px] py-[3px] text-xs font-bold text-ink-900"
                  >
                    {item.substance}
                    {item.verification_status === "UNCONFIRMED" && (
                      <span className="text-[10px] font-semibold text-ink-500">(reported)</span>
                    )}
                  </span>
                ))
              ) : (
                <span className={`text-xs font-semibold ${allergyTone}`}>
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
          className={`${cell} flex flex-col gap-3.5`}
          aria-label="Current setting and triage priority"
        >
          <div>
            <div className={label}>Current setting</div>
            <div className="flex items-start gap-2 break-words text-sm font-bold leading-snug text-ink-900">
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
          </div>
          <div>
            <div className={label}>Triage / risk priority</div>
            {priority ? (
              <span
                className={`inline-flex w-fit items-center gap-2 rounded-[11px] py-[5px] pl-[7px] pr-3 text-[13px] font-extrabold text-on-status ${PRIORITY_SOLID[priority]}`}
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

        <div className={`${cell} flex flex-col gap-3.5`} aria-label="Clinical alerts and care team">
          <div>
            <div className={label}>Critical clinical alerts</div>
            {banner.alerts.length > 0 ? (
              <div className="flex flex-wrap gap-1.5">
                {banner.alerts.map((alert) => (
                  <span
                    key={alert.id}
                    className="inline-flex max-w-full items-center gap-1.5 break-words rounded-[9px] border border-priority-orange/40 bg-priority-orange-tint px-2.5 py-1 text-xs font-bold text-priority-orange"
                  >
                    <AlertTriangle className="h-[15px] w-[15px] flex-none" />
                    {alert.label}
                  </span>
                ))}
              </div>
            ) : (
              <span className="text-xs font-semibold text-ink-400">No critical alerts</span>
            )}
          </div>
          <div>
            <div className={label}>Responsible clinician / team</div>
            <div className="break-words text-sm font-bold leading-snug text-ink-900">
              {banner.clinician}
              {banner.team && (
                <>
                  <br />
                  <span className="text-xs font-semibold text-ink-400">{banner.team}</span>
                </>
              )}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
