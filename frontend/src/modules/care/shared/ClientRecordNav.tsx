import { MoreVertical } from "lucide-react";
import { useEffect, useRef, useState } from "react";
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

function statusPresentation(status: JourneyStageStatus) {
  switch (status) {
    case "complete":
      return { label: "Complete" };
    case "in_progress":
      return { label: "In progress" };
    case "incomplete":
      return { label: "Incomplete" };
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

// The record's main views, in the order clinicians use them; the rest are one
// click away in the ⋮ menu (an open one also shows as a tab).
const PRIMARY_KEYS = ["journey", "mse", "legal"];
const PRIMARY_VIEWS = PRIMARY_KEYS.map((key) => RECORD_VIEWS.find((item) => item.key === key)!);
const MORE_VIEWS = RECORD_VIEWS.filter((item) => !PRIMARY_KEYS.includes(item.key));
const MORE_HINTS: Record<string, string> = {
  snapshot: "Overview of the client now",
  timeline: "Everything recorded, by date",
  charts: "Vitals and scores over time",
  attachments: "Uploaded documents and files",
};

function MoreViews({ patientId, activeTop }: { patientId: string; activeTop: string }) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onClick = (event: MouseEvent) => {
      if (box.current && !box.current.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);
  return (
    <div ref={box} className="relative ml-auto">
      <button
        type="button"
        aria-label="More record views"
        title="More views: snapshot, timeline, charts, attachments"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        className="grid h-8 w-8 place-items-center rounded-md text-ink-500 hover:bg-surface-bg hover:text-ink-900 aria-expanded:bg-surface-bg"
      >
        <MoreVertical aria-hidden className="h-4 w-4" />
      </button>
      {open && (
        <div
          role="menu"
          aria-label="More record views"
          className="absolute right-0 top-full z-30 mt-1 w-52 rounded-lg border border-surface-border bg-surface-card p-1 shadow-[0_12px_32px_rgba(16,34,29,.16)]"
        >
          {MORE_VIEWS.map((item) => (
            <NavLink
              key={item.key}
              role="menuitem"
              to={clientRecordPath(patientId, item.key as RecordView)}
              onClick={() => setOpen(false)}
              className={`block rounded-md px-3 py-2 text-[13px] font-medium ${
                item.key === activeTop
                  ? "bg-surface-bg text-ink-900"
                  : "text-ink-700 hover:bg-surface-bg hover:text-ink-900"
              }`}
            >
              <span className="block">{item.label}</span>
              {MORE_HINTS[item.key] && (
                <span className="block text-[11.5px] font-normal text-ink-500">
                  {MORE_HINTS[item.key]}
                </span>
              )}
            </NavLink>
          ))}
        </div>
      )}
    </div>
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
  const moreActive = MORE_VIEWS.find((item) => item.key === activeTop);
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
        className="mb-2 flex items-center gap-1.5 border-b border-surface-border pb-1"
      >
        {[...PRIMARY_VIEWS, ...(moreActive ? [moreActive] : [])].map((item) => {
          const active = item.key === activeTop;
          const target = item.key === "journey" ? "intake" : item.key;
          return (
            <NavLink
              key={item.key}
              to={clientRecordPath(patientId, target as RecordView)}
              aria-current={active ? "page" : undefined}
              className={`-mb-px whitespace-nowrap border-b-2 px-3 py-1.5 text-[13px] font-semibold transition-colors duration-150 ${
                active
                  ? "border-brand-green text-ink-900"
                  : "border-transparent text-ink-500 hover:text-ink-900"
              }`}
            >
              {item.label}
            </NavLink>
          );
        })}
        <MoreViews patientId={patientId} activeTop={activeTop} />
      </nav>
      {activeTop === "journey" && (
        // The care journey as one quiet line: a dot per stage (green complete,
        // amber in progress, hollow not started), the current stage in bold and
        // underlined, and each stage's status named on hover and to screen readers.
        <nav aria-label="Client care journey" className="mb-3 flex items-center overflow-x-auto">
          {JOURNEY_STAGES.filter((stage) => stage.key !== "snapshot").map((stage, index, all) => {
            const active = stage.key === view;
            const status = stageStatus(stage.key);
            // The line into this stage turns green once both stages it joins are
            // complete, so the finished part of the journey reads as one path.
            const joined =
              index > 0 && status === "complete" && stageStatus(all[index - 1].key) === "complete";
            const { label } = statusPresentation(status);
            return (
              <span key={stage.key} className="flex flex-none items-center">
                {index > 0 && (
                  <span
                    aria-hidden
                    className={`mx-1 h-0.5 w-8 rounded-full ${
                      joined ? "bg-priority-green-solid" : "bg-surface-border"
                    }`}
                  />
                )}
                <NavLink
                  to={clientRecordPath(patientId, stage.key)}
                  aria-current={active ? "step" : undefined}
                  aria-label={`${stage.label} — ${label}`}
                  title={`${stage.label} — ${label.toLowerCase()}`}
                  className={`flex items-center gap-1.5 rounded-md px-2 py-1 text-[13px] transition-colors duration-150 ${
                    active
                      ? "font-bold text-ink-900 underline decoration-brand-green decoration-2 underline-offset-[6px]"
                      : "font-medium text-ink-500 hover:text-ink-900"
                  }`}
                >
                  <span
                    aria-hidden
                    className={`h-2 w-2 flex-none rounded-full ${
                      status === "complete"
                        ? "bg-priority-green-solid"
                        : status === "in_progress"
                          ? "bg-priority-yellow-solid"
                          : "border border-ink-400"
                    }`}
                  />
                  {stage.label}
                </NavLink>
              </span>
            );
          })}
        </nav>
      )}
    </>
  );
}
