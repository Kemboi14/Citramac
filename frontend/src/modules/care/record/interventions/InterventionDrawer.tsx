import { ArrowLeft, X } from "lucide-react";
import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
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

/** An open clinical module (v4 `moduleDrawer`): header, Record / History /
 * Info tabs. Shown in the page in place of the module list, so the main
 * navigation, client banner and record tabs stay in view; Back (or Escape)
 * returns to the list. */
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
  const panelRef = useRef<HTMLElement>(null);
  // The client banner is sticky: open the module just below it, and size the
  // guided session to the space left under it.
  const [bannerHeight] = useState(() =>
    Math.round(document.querySelector("[data-safety-banner]")?.getBoundingClientRect().height ?? 0),
  );
  useEffect(() => {
    const panel = panelRef.current;
    if (!panel) return;
    panel.style.scrollMarginTop = `${bannerHeight + 12}px`;
    panel.scrollIntoView({ block: "start" });
    panel.focus({ preventScroll: true });
  }, [bannerHeight]);
  const id = useId();
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const [tab, setTab] = useState<Tab>("Record");
  const showForm = Boolean(module.billing_service) && !OWN_DELIVERY.has(module.code);
  // v4: the psychotherapy module is the guided session itself — no tabs, and
  // the workflow fills the screen under the module header.
  const guided = module.code === "psychotherapy";

  const onTabKey = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    if (event.key !== "ArrowRight" && event.key !== "ArrowLeft") return;
    event.preventDefault();
    const next = (index + (event.key === "ArrowRight" ? 1 : TABS.length - 1)) % TABS.length;
    setTab(TABS.at(next) ?? "Record");
    tabRefs.current.at(next)?.focus();
  };

  return (
    <section
      ref={panelRef}
      tabIndex={-1}
      aria-labelledby={`${id}-title`}
      onKeyDown={(event) => {
        if (event.key === "Escape" && event.target === event.currentTarget) onClose();
      }}
      style={
        guided ? { height: `max(560px, calc(100dvh - ${bannerHeight + 56 + 28}px))` } : undefined
      }
      className="flex flex-col overflow-hidden rounded-lg border border-surface-border bg-surface-card shadow-sm outline-none"
    >
      <button
        type="button"
        onClick={onClose}
        className={`flex items-center gap-1.5 self-start pt-3 text-[12.5px] font-semibold text-brand-green hover:underline ${GUTTER}`}
      >
        <ArrowLeft className="h-3.5 w-3.5" /> Back to clinical modules
      </button>
      <div
        className={`flex items-center gap-[11px] border-b border-surface-border pb-4 pt-2 ${GUTTER}`}
      >
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
          aria-label="Close module"
          className="ml-auto grid h-9 w-9 flex-shrink-0 place-items-center rounded-lg text-ink-500 transition-colors hover:bg-surface-bg"
        >
          <X className="h-5 w-5" />
        </button>
      </div>

      {guided ? (
        <div className="flex min-h-0 flex-1 flex-col">
          <PsychotherapyRecord patientId={patientId} onClose={onClose} />
        </div>
      ) : (
        <>
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
            className={`w-full flex-1 pb-8 pt-[18px] ${GUTTER}`}
          >
            {tab === "Record" && (
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
            )}
            {tab === "History" && (
              <ModuleHistory module={module} records={records} onCorrected={onCorrected} />
            )}
            {tab === "Info" && <ModuleInfo module={module} />}
          </div>
        </>
      )}
    </section>
  );
}
