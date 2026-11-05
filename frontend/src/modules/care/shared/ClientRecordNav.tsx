import { Check, Circle, CircleDot } from "lucide-react";
import { NavLink } from "react-router-dom";
import type { ClientBanner, JourneyStageStatus } from "../../../lib/carePathwayApi";
import {
  clientRecordPath,
  JOURNEY_KEYS,
  JOURNEY_STAGES,
  RECORD_VIEWS,
  type RecordView,
} from "./recordRoutes";

type JourneyNavKey = (typeof JOURNEY_STAGES)[number]["key"];

const JOURNEY_STATUS_OPTIONS: JourneyStageStatus[] = ["complete", "in_progress", "incomplete"];

function statusPresentation(status: JourneyStageStatus) {
  switch (status) {
    case "complete":
      return { label: "Complete", Icon: Check, color: "text-brand-green" };
    case "in_progress":
      return { label: "In progress", Icon: CircleDot, color: "text-accent-info" };
    case "incomplete":
      return { label: "Incomplete", Icon: Circle, color: "text-priority-orange" };
  }
}

function persistedStatus(
  status: ClientBanner["journey_status"],
  key: JourneyNavKey,
): JourneyStageStatus | undefined {
  if (!status) return undefined;
  switch (key) {
    case "triage":
      return status.triage;
    case "intake":
      return status.intake;
    case "care-plan":
      return status["care-plan"];
    case "interventions":
      return status.interventions;
    case "outcomes":
      return status.outcomes;
    case "billing":
      return status.billing;
    case "follow-up":
      return status["follow-up"];
    case "snapshot":
      return undefined;
  }
}

function StageStatusIcon({ status }: { status: JourneyStageStatus }) {
  const { Icon, color } = statusPresentation(status);
  return (
    <span
      aria-hidden="true"
      className={`flex h-[18px] w-[18px] shrink-0 items-center justify-center ${color}`}
    >
      <Icon className={status === "complete" ? "h-[17px] w-[17px]" : "h-[16px] w-[16px]"} />
    </span>
  );
}

export function ClientRecordNav({
  patientId,
  view,
  banner,
}: {
  patientId: string;
  view: RecordView;
  banner?: Pick<ClientBanner, "journey_status" | "latest_signed_triage_encounter_id"> | null;
}) {
  const activeTop = JOURNEY_KEYS.has(view) ? "journey" : view;
  const stageStatus = (key: JourneyNavKey): JourneyStageStatus => {
    if (key !== "snapshot") {
      const persisted = persistedStatus(banner?.journey_status, key);
      if (persisted) return persisted;
    }
    if (key === "triage" && banner?.latest_signed_triage_encounter_id) return "complete";
    return key === view ? "in_progress" : "incomplete";
  };
  return (
    <>
      <nav
        aria-label="Client record views"
        className="mb-3 flex gap-1.5 overflow-x-auto border-b border-surface-border pb-[9px]"
      >
        {RECORD_VIEWS.map((item) => {
          const active = item.key === activeTop;
          const target = item.key === "journey" ? "intake" : item.key;
          return (
            <NavLink
              key={item.key}
              to={clientRecordPath(patientId, target)}
              aria-current={active ? "page" : undefined}
              className={`-mb-px whitespace-nowrap border-b-2 px-3 py-[9px] text-[13px] font-semibold transition-colors duration-150 ${
                active
                  ? "border-brand-green text-ink-900"
                  : "border-transparent text-ink-500 hover:text-ink-900"
              }`}
            >
              {item.label}
            </NavLink>
          );
        })}
      </nav>
      {activeTop === "journey" && (
        <>
          <nav
            aria-label="Client care journey"
            className="mb-1 flex items-center gap-1 overflow-x-auto rounded-xl border border-surface-border bg-surface-card p-1.5 shadow-[0_2px_8px_rgba(16,48,42,.04)]"
          >
            {JOURNEY_STAGES.map((stage) => {
              const active = stage.key === view;
              const status = stageStatus(stage.key);
              const { label } = statusPresentation(status);
              return (
                <NavLink
                  key={stage.key}
                  to={clientRecordPath(patientId, stage.key)}
                  aria-current={active ? "step" : undefined}
                  aria-label={`${stage.label} — ${label}`}
                  className={`flex min-h-10 flex-none items-center gap-2 rounded-lg border px-3 py-2 text-[13px] font-semibold transition-colors duration-150 ${
                    active
                      ? "border-brand-green/30 bg-brand-green-tint text-brand-green-dark shadow-sm"
                      : "border-transparent text-ink-700 hover:border-surface-border hover:bg-surface-bg hover:text-ink-900"
                  }`}
                >
                  <StageStatusIcon status={status} />
                  {stage.label}
                </NavLink>
              );
            })}
          </nav>
          <div
            role="group"
            aria-label="Journey stage status"
            className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-ink-500"
          >
            {JOURNEY_STATUS_OPTIONS.map((status) => (
              <span key={status} className="inline-flex items-center gap-1">
                <StageStatusIcon status={status} />
                {statusPresentation(status).label}
              </span>
            ))}
          </div>
        </>
      )}
    </>
  );
}
