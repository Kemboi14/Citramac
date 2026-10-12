import { useEffect, useState } from "react";
import { useAuth } from "../../../../auth/useAuth";
import { getModuleRecommendations } from "../../../../lib/carePathwayApi";
import { Link } from "react-router-dom";
import { BTN_GHOST, BTN_SM } from "../../shared/styles";
import { Card } from "../../shared/ui";
import { MarModule, PrescribingModule, SbarModule } from "./SmallModules";
import { ObservationModule } from "./ObservationModule";
import { WithdrawalModule } from "./WithdrawalModule";
import { LabsModule, LegalFormsModule, OatModule, TherapyModule } from "./ClinicalExtras";
import { RestrictiveModule } from "./RestrictiveModule";

const IN_RECORD = [
  { key: "sbar", title: "SBAR handover", note: "Built from the record" },
  { key: "obs", title: "Observation & safety", note: "Level, signed entries, observation sets + early warning score" },
  { key: "meds", title: "Prescribing check", note: "Allergy and duplicate check before prescribing" },
  { key: "mar", title: "Medication administration (MAR)", note: "Today’s doses, PRN, controlled drugs" },
  { key: "withdrawal", title: "Withdrawal chart", note: "CIWA-Ar / COWS scoring and re-score due time" },
  { key: "therapy", title: "Therapy", note: "Therapy contract and session notes" },
  { key: "oat", title: "OAT & naloxone", note: "Opioid agonist therapy referral and naloxone" },
  { key: "labs", title: "Blood work", note: "Results, abnormal-result acknowledgement" },
  { key: "legal", title: "Statutory forms", note: "Forms linked to legal status" },
  { key: "restraint", title: "Restrictive practice", note: "De-escalation first, authoriser, timed checks, debrief" },
] as const;
type Key = (typeof IN_RECORD)[number]["key"];

const LINKS = [
  { to: "/clinical/pharmacy", title: "Pharmacy", note: "Dispensing" },
  { to: "/clinical/inpatient", title: "Admission", note: "Admissions and legal status" },
  { to: "/clinical/psychotherapy/individual", title: "Psychotherapy", note: "Individual, family and group sessions" },
  { to: "/clinical/discharge", title: "Discharge", note: "Signed discharge planning" },
];

/** Clinical modules for the current client — opened in place, so the client
 * context carries forward and nothing is re-entered. */
export function ModulesPanel({ patientId }: { patientId: string }) {
  const { accessToken } = useAuth();
  const [open, setOpen] = useState<Key | null>(null);
  const [recommended, setRecommended] = useState<Record<string, string[]>>({});
  useEffect(() => {
    if (accessToken) getModuleRecommendations(accessToken, patientId).then((r) => setRecommended(r.recommended)).catch(() => undefined);
  }, [accessToken, patientId]);
  return (
    <Card title="Clinical modules" className="mb-4">
      <div className="flex flex-wrap gap-2">
        {IN_RECORD.map((m) => (
          <button
            key={m.key}
            type="button"
            aria-pressed={open === m.key}
            title={recommended[m.key] ? `Recommended by the plan: ${recommended[m.key].join("; ")}` : m.note}
            className={`${BTN_GHOST} ${BTN_SM} ${open === m.key ? "!border-brand-green !bg-brand-green-tint" : ""}`}
            onClick={() => setOpen(open === m.key ? null : m.key)}
          >
            {m.title}{recommended[m.key] ? " ★" : ""}
          </button>
        ))}
        {LINKS.map((l) => (
          <Link key={l.to} to={l.to} title={l.note} className={`${BTN_GHOST} ${BTN_SM}`}>
            {l.title} ↗
          </Link>
        ))}
      </div>
      {open && (
        <div className="mt-4 border-t border-surface-border pt-4">
          <h3 className="mb-2 font-display text-sm font-semibold">{IN_RECORD.find((m) => m.key === open)?.title}</h3>
          {open === "sbar" && <SbarModule patientId={patientId} />}
          {open === "obs" && <ObservationModule patientId={patientId} />}
          {open === "meds" && <PrescribingModule patientId={patientId} />}
          {open === "mar" && <MarModule patientId={patientId} />}
          {open === "withdrawal" && <WithdrawalModule patientId={patientId} />}
          {open === "therapy" && <TherapyModule patientId={patientId} />}
          {open === "oat" && <OatModule patientId={patientId} />}
          {open === "labs" && <LabsModule patientId={patientId} />}
          {open === "legal" && <LegalFormsModule patientId={patientId} />}
          {open === "restraint" && <RestrictiveModule patientId={patientId} />}
        </div>
      )}
    </Card>
  );
}
