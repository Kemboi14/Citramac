import { X } from "lucide-react";
import { useId, useRef, useState, type KeyboardEvent } from "react";
import { createPortal } from "react-dom";
import { useDialogA11y } from "../../../../components/useDialogA11y";
import type {
  InterventionAction,
  InterventionContext,
  InterventionModule,
  InterventionRecord,
} from "../../../../lib/carePathwayApi";
import { ClinicalContext } from "./ClinicalContext";
import { DeliveryForm } from "./DeliveryForm";
import { ModuleHistory } from "./ModuleHistory";
import { ModuleIcon, RecommendedBadge } from "./ModuleList";
import { ModuleInfo } from "./ModuleInfo";
import { ModuleTools } from "./ModuleTools";
import { rateText } from "./rates";

const TABS = ["Record", "History", "Info"] as const;
type Tab = (typeof TABS)[number];
const GUTTER = "px-[clamp(18px,4vw,48px)]";

/** Full-screen module drawer (mockup `openInterventionDrawer`): header,
 * Record / History / Info tabs. Portal-rendered so `position: fixed` is not
 * captured by an animated ancestor (see components/WideModal). */
export function InterventionDrawer({
  patientId,
  clientName,
  module,
  actions,
  context,
  records,
  onClose,
  onRecorded,
  onCorrected,
}: {
  patientId: string;
  clientName: string;
  module: InterventionModule;
  actions: InterventionAction[];
  context: InterventionContext;
  records: InterventionRecord[];
  onClose: () => void;
  onRecorded: () => void;
  onCorrected: (message: string) => void;
}) {
  const dialogRef = useDialogA11y<HTMLElement>(true, onClose);
  const id = useId();
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const [tab, setTab] = useState<Tab>("Record");
  const action = actions.find((item) => item.id === module.action_id);

  const onTabKey = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    if (event.key !== "ArrowRight" && event.key !== "ArrowLeft") return;
    event.preventDefault();
    const next = (index + (event.key === "ArrowRight" ? 1 : TABS.length - 1)) % TABS.length;
    setTab(TABS.at(next) ?? "Record");
    tabRefs.current.at(next)?.focus();
  };

  return createPortal(
    <div
      className="fixed inset-0 z-[90] flex justify-center overflow-auto bg-surface-bg"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={`${id}-title`}
        className="flex min-h-full w-full flex-col bg-surface-card"
      >
        <div className={`flex items-center gap-3 border-b border-surface-border py-[18px] ${GUTTER}`}>
          <ModuleIcon name={module.name} large />
          <div className="min-w-0 flex-1 pt-px">
            <div className="flex flex-wrap items-center gap-2">
              <h2 id={`${id}-title`} className="font-display text-[15px] font-bold text-ink-900">
                {module.name}
              </h2>
              {module.recommended && <RecommendedBadge />}
            </div>
            <p className="mt-[3px] text-xs text-ink-500">
              {module.recommended
                ? `Suggested from the existing client record · ${module.reason}`
                : "Record care delivered and link it to a plan action when appropriate."}
            </p>
            <div className="mt-[3px] text-xs text-ink-500">{rateText(module)}</div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close record form"
            className="ml-auto grid h-9 w-9 flex-shrink-0 place-items-center rounded-lg text-ink-500 transition-colors hover:bg-surface-bg"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div
          role="tablist"
          aria-label="Intervention details"
          className={`flex gap-0.5 border-b border-surface-border ${GUTTER}`}
        >
          {TABS.map((name, index) => (
            <button
              key={name}
              ref={(node) => {
                // eslint-disable-next-line security/detect-object-injection -- `index` is the map position.
                tabRefs.current[index] = node;
              }}
              id={`${id}-tab-${name}`}
              type="button"
              role="tab"
              aria-selected={tab === name}
              aria-controls={`${id}-panel`}
              tabIndex={tab === name ? 0 : -1}
              onClick={() => setTab(name)}
              onKeyDown={(event) => onTabKey(event, index)}
              className={`min-h-[40px] border-b-2 px-3 py-[9px] text-[13px] font-semibold transition-colors ${
                tab === name
                  ? "border-brand-green text-brand-green"
                  : "border-transparent text-ink-500 hover:text-ink-900"
              }`}
            >
              {name}
            </button>
          ))}
        </div>

        <div
          id={`${id}-panel`}
          role="tabpanel"
          aria-labelledby={`${id}-tab-${tab}`}
          className={`w-full max-w-[1120px] flex-1 self-center pb-8 pt-6 ${GUTTER}`}
        >
          {tab === "Record" && (
            <>
              <ClinicalContext context={context} />
              <DeliveryForm
                patientId={patientId}
                module={module}
                actions={actions}
                onRecorded={onRecorded}
              />
              <ModuleTools code={module.code} patientId={patientId} />
            </>
          )}
          {tab === "History" && (
            <ModuleHistory
              module={module}
              records={records}
              clientName={clientName}
              onCorrected={onCorrected}
            />
          )}
          {tab === "Info" && <ModuleInfo module={module} action={action} />}
        </div>
      </section>
    </div>,
    document.body,
  );
}
