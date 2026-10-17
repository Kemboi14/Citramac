import { useState } from "react";
import type { PlanWorkspace, SafetyPlanDoc } from "../../../../lib/carePathwayApi";
import { WideModal } from "../../../../components/WideModal";
import { BTN, BTN_GHOST } from "../../shared/styles";
import { Callout } from "../../shared/ui";
import { SAFETY_KEYS, SAFETY_LABELS } from "./safetyLabels";

// Headings of the client's view, from the approved mockup (`openCoprod`). The
// Kiswahili text is the mockup's draft — shown with a translator warning.
const TEXT = {
  en: {
    heading: "Your plan",
    matters: "What matters most to you",
    goals: "Your goals",
    actions: "What we will do together",
    agree: "I have read this plan and I agree with it",
    disagree: "I don’t agree with part of it",
  },
  sw: {
    heading: "Mpango wako",
    matters: "Kinachokuhusu zaidi",
    goals: "Malengo yako",
    actions: "Tutakachofanya pamoja",
    agree: "Nimesoma mpango huu na ninaukubali",
    disagree: "Sikubaliani na sehemu fulani",
  },
} as const;

/** "Show the plan to the client": large text, in their language, with the
 * client's own acknowledgement or disagreement recorded from this device. */
export function CoProductionView({
  open,
  clientName,
  ws,
  safetyPlan,
  onClose,
  onAcknowledge,
  onDisagree,
}: {
  open: boolean;
  clientName: string;
  ws: PlanWorkspace;
  safetyPlan: SafetyPlanDoc | null;
  onClose: () => void;
  onAcknowledge: (language: "en" | "sw") => void;
  onDisagree: () => void;
}) {
  const [language, setLanguage] = useState<"en" | "sw">(safetyPlan?.language ?? "en");
  // eslint-disable-next-line security/detect-object-injection -- `language` is a typed union.
  const text = TEXT[language];
  // eslint-disable-next-line security/detect-object-injection -- `language` is a typed union.
  const labels = SAFETY_LABELS[language];
  const goals = ws.details.goal_items.filter((g) => g.goal.trim());
  const actions = ws.actions.filter((a) => a.decision && a.decision !== "DECLINED");
  // eslint-disable-next-line security/detect-object-injection -- `k` is one of SAFETY_KEYS.
  const safety = ws.needs_safety_plan && safetyPlan ? SAFETY_KEYS.filter((k) => safetyPlan[k].trim()) : [];

  return (
    <WideModal open={open} title={`${text.heading} — ${clientName}`} onClose={onClose}>
      <div className="flex flex-col gap-4 text-[17px] leading-relaxed text-ink-900">
        <div role="group" aria-label="Language" className="flex gap-1.5">
          {(["en", "sw"] as const).map((code) => (
            <button
              key={code}
              type="button"
              aria-pressed={language === code}
              className={`rounded-md border px-3 py-1.5 text-[13px] font-semibold ${language === code ? "border-brand-green bg-brand-green-tint" : "border-surface-border"}`}
              onClick={() => setLanguage(code)}
            >
              {code === "en" ? "English" : "Kiswahili"}
            </button>
          ))}
        </div>
        {language === "sw" && (
          <Callout tone="warning">
            Tafsiri ya majaribio — ithibitishwe na mtafsiri kabla ya matumizi ya kliniki. (Draft translation — verify
            with a qualified translator before clinical use.)
          </Callout>
        )}
        <section>
          <h3 className="font-display text-lg font-bold">{text.matters}</h3>
          <p>{ws.details.what_matters || "—"}</p>
        </section>
        <section>
          <h3 className="font-display text-lg font-bold">{text.goals}</h3>
          <ul className="list-disc pl-6">
            {goals.length ? goals.map((g, i) => <li key={i}>{g.goal}</li>) : <li>—</li>}
          </ul>
        </section>
        <section>
          <h3 className="font-display text-lg font-bold">{text.actions}</h3>
          <ul className="list-disc pl-6">
            {actions.length ? (
              actions.map((a) => (
                <li key={a.id}>
                  {a.name}
                  {a.instructions ? ` — ${a.instructions}` : ""}
                </li>
              ))
            ) : (
              <li>—</li>
            )}
          </ul>
        </section>
        {safety.length > 0 && safetyPlan && (
          <section>
            <h3 className="font-display text-lg font-bold">{labels.title}</h3>
            <ul className="list-disc pl-6">
              {safety.map((k) => (
                <li key={k}>
                  {/* eslint-disable-next-line security/detect-object-injection -- `k` is one of SAFETY_KEYS. */}
                  <strong>{labels[k]}:</strong> {safetyPlan[k]}
                </li>
              ))}
            </ul>
          </section>
        )}
        <div className="flex flex-wrap gap-2 pt-2">
          <button type="button" className={BTN} onClick={() => onAcknowledge(language)}>
            {text.agree}
          </button>
          <button type="button" className={BTN_GHOST} onClick={onDisagree}>
            {text.disagree}
          </button>
        </div>
      </div>
    </WideModal>
  );
}
