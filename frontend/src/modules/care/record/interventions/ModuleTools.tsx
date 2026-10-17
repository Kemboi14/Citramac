import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { DocumentLibrary } from "../../../../components/DocumentLibrary";
import { BTN_GHOST, BTN_SM } from "../../shared/styles";
import { Card } from "../../shared/ui";
import { LegalFormsModule, OatModule } from "../modules/ClinicalExtras";
import { LabsModule } from "../modules/LabsModule";
import { MarModule } from "../modules/MarModule";
import { ObservationModule } from "../modules/ObservationModule";
import { PrescribingModule } from "../modules/PrescribingModule";
import { RestrictiveModule } from "../modules/RestrictiveModule";
import { SbarModule } from "../modules/SmallModules";
import { TherapyModule } from "../modules/TherapyModule";
import { WithdrawalModule } from "../modules/WithdrawalModule";

interface Tool {
  title: string;
  note: string;
  render: (patientId: string) => ReactNode;
}

interface FullPage {
  to: string;
  label: string;
}

/** Specialised module content shown in the drawer's Record tab, in a
 * collapsible "Module tools" section below the delivery form (the mockup's
 * Record tab is clinical context then the form) — the same components the
 * record already uses, so each concept keeps one store (CLAUDE.md §4). */
const TOOLS = new Map<string, Tool>(Object.entries({
  emergency_care: {
    title: "SBAR handover",
    note: "Built from the record",
    render: (id: string) => <SbarModule patientId={id} />,
  },
  observation_safety: {
    title: "Observation & safety",
    note: "Level, signed entries, observation sets + early warning score",
    render: (id: string) => <ObservationModule patientId={id} />,
  },
  blood_work: {
    title: "Blood work",
    note: "Order sets, result entry, abnormal-result acknowledgement",
    render: (id: string) => <LabsModule patientId={id} />,
  },
  psychiatry: {
    title: "Medication orders",
    note: "Structured orders — allergy and duplicate checks run before the order is placed",
    render: (id: string) => <PrescribingModule patientId={id} />,
  },
  admission: {
    title: "Statutory forms",
    note: "Forms linked to legal status",
    render: (id: string) => <LegalFormsModule patientId={id} />,
  },
  withdrawal_management: {
    title: "Withdrawal chart",
    note: "CIWA-Ar / COWS serial chart, scoring and re-score due time",
    render: (id: string) => <WithdrawalModule patientId={id} />,
  },
  opioid_agonist_therapy: {
    title: "OAT & naloxone",
    note: "Opioid agonist therapy referral and naloxone",
    render: (id: string) => <OatModule patientId={id} />,
  },
  psychiatric_nursing: {
    title: "Medication administration (MAR)",
    note: "Today’s doses, PRN limits, controlled drugs, SBAR shift handover",
    render: (id: string) => <MarModule patientId={id} />,
  },
  restrictive_practice: {
    title: "Restrictive practice",
    note: "De-escalation first, authoriser, timed checks, debrief",
    render: (id: string) => <RestrictiveModule patientId={id} />,
  },
  psychotherapy: {
    title: "Therapy",
    note: "Therapy contract, numbered sessions, measurement-based care",
    render: (id: string) => <TherapyModule patientId={id} />,
  },
  attachments: {
    title: "Client documents",
    note: "Clinical documents, referrals and correspondence on this record",
    render: (id: string) => <DocumentLibrary patientId={id} />,
  },
}));

/** Modules whose full workflow lives on its own page. */
const FULL_PAGES = new Map<string, FullPage>(Object.entries({
  admission: { to: "/clinical/inpatient", label: "Open Admissions" },
  psychiatric_nursing: { to: "/clinical/pharmacy", label: "Open Pharmacy" },
  psychotherapy: { to: "/clinical/psychotherapy/individual", label: "Open Psychotherapy" },
  discharge: { to: "/clinical/discharge", label: "Open Discharge planning" },
}));

export function ModuleTools({ code, patientId }: { code: string; patientId: string }) {
  const tool = TOOLS.get(code);
  const page = FULL_PAGES.get(code);
  if (!tool && !page) return null;
  return (
    <details className="mt-4 rounded-lg border border-surface-border bg-surface-card">
      <summary className="flex min-h-[44px] cursor-pointer flex-wrap items-center gap-2 px-3.5 py-2 text-xs font-semibold text-brand-green">
        Module tools
        <span className="font-normal text-ink-500">
          {[tool?.title, page?.label].filter(Boolean).join(" · ")}
        </span>
      </summary>
      <div className="flex flex-col gap-3 border-t border-surface-border p-3.5">
        {tool && (
          <Card
            title={
              <span>
                {tool.title}
                <span className="ml-2 text-xs font-normal text-ink-500">{tool.note}</span>
              </span>
            }
          >
            {tool.render(patientId)}
          </Card>
        )}
        {page && (
          <Link to={page.to} className={`${BTN_GHOST} ${BTN_SM} self-start`}>
            {page.label} ↗
          </Link>
        )}
      </div>
    </details>
  );
}
