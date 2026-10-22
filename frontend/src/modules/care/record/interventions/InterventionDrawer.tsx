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
import { ModuleIcon, ModuleMeta } from "./ModuleList";
import { ModuleInfo, ModuleNote } from "./ModuleInfo";
import { ModuleTools } from "./ModuleTools";
import { PsychotherapyRecord } from "./PsychotherapyRecord";

/** v4 `appendModuleRecord`: the delivery form shows for separately priced
 * modules, except where the module's own workflow records the delivery
 * (the signed psychotherapy note; laboratory orders). */
const OWN_DELIVERY = new Set(["psychotherapy", "blood_work"]);

const TABS = ["Record", "History", "Info"] as const;
type Tab = (typeof TABS)[number];
const GUTTER = "px-[clamp(18px,4vw,48px)]";

/** Full-screen module drawer (v4 `moduleDrawer`): header, Record / History /
 * Info tabs. Portal-rendered so `position: fixed` is not captured by an
 * animated ancestor (see components/WideModal). */
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
  onRecorded: (message: string) => void;
  onCorrected: (message: string) => void;
}) {
  const dialogRef = useDialogA11y<HTMLElement>(true, onClose);
  const id = useId();
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const [tab, setTab] = useState<Tab>("Record");
  const showForm = Boolean(module.billing_service) && !OWN_DELIVERY.has(module.code);

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
        <div className={`flex items-center gap-[11px] border-b border-surface-border py-4 ${GUTTER}`}>
          <ModuleIcon code={module.code} recommended={module.recommended} large />
          <div className="min-w-0 flex-1">
            <h2 id={`${id}-title`} className="sr-only">
              {module.name}
            </h2>
            <ModuleMeta module={module} actions={actions} />
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
          className={`w-full max-w-[1200px] flex-1 self-center pb-8 pt-[18px] ${GUTTER}`}
        >
          {tab === "Record" &&
            (module.code === "psychotherapy" ? (
              <PsychotherapyRecord patientId={patientId} onClose={onClose} />
            ) : (
              <>
                <ClinicalContext context={context} />
                {module.note && <ModuleNote note={module.note} />}
                <ModuleTools code={module.code} patientId={patientId} clientName={clientName} />
                {showForm && (
                  <DeliveryForm
                    patientId={patientId}
                    module={module}
                    actions={actions}
                    onRecorded={(message) => {
                      onRecorded(message);
                      setTab("History");
                    }}
                  />
                )}
              </>
            ))}
          {tab === "History" && (
            <ModuleHistory module={module} records={records} onCorrected={onCorrected} />
          )}
          {tab === "Info" && <ModuleInfo module={module} />}
        </div>
      </section>
    </div>,
    document.body,
  );
}
