import { NavLink } from "react-router-dom";
import {
  clientRecordPath,
  JOURNEY_KEYS,
  JOURNEY_STAGES,
  RECORD_VIEWS,
  type RecordView,
} from "./recordRoutes";

export function ClientRecordNav({ patientId, view }: { patientId: string; view: RecordView }) {
  const activeTop = JOURNEY_KEYS.has(view) ? "journey" : view;
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
        <nav
          aria-label="Client care journey"
          className="mb-3 flex items-center gap-1 overflow-x-auto rounded-xl border border-surface-border bg-surface-card p-1.5 shadow-[0_2px_8px_rgba(16,48,42,.04)]"
        >
          {JOURNEY_STAGES.map((stage) => {
            const active = stage.key === view;
            return (
              <NavLink
                key={stage.key}
                to={clientRecordPath(patientId, stage.key)}
                aria-current={active ? "step" : undefined}
                className={`flex min-h-10 flex-none items-center rounded-lg px-[15px] py-[9px] text-[13px] font-semibold transition-colors duration-150 ${
                  active
                    ? "bg-brand-green text-on-primary shadow-[0_2px_5px_rgba(0,80,61,.16)]"
                    : "text-ink-500 hover:bg-surface-bg hover:text-ink-900"
                }`}
              >
                {stage.label}
              </NavLink>
            );
          })}
        </nav>
      )}
    </>
  );
}
