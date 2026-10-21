import { useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { DocumentLibrary } from "../../../../components/DocumentLibrary";
import { getClientFollowUps } from "../../../../lib/carePlanOutcomesApi";
import { clientRecordPath } from "../../shared/recordRoutes";
import { BTN_GHOST, BTN_SM } from "../../shared/styles";
import { Card, ErrorNote } from "../../shared/ui";
import { LegalAdmissionStatus } from "../legal/LegalAdmissionStatus";
import { LegalFormsModule, OatModule } from "../modules/ClinicalExtras";
import { LabsModule } from "../modules/LabsModule";
import { MarModule } from "../modules/MarModule";
import { ObservationModule } from "../modules/ObservationModule";
import { PrescribingModule } from "../modules/PrescribingModule";
import { RestrictiveModule } from "../modules/RestrictiveModule";
import { SbarModule } from "../modules/SmallModules";
import { TherapyModule } from "../modules/TherapyModule";
import { WithdrawalModule } from "../modules/WithdrawalModule";
import { FollowUpPanel } from "../outcomes/FollowUpPanel";
import { useRecordData } from "../useRecordData";

interface Target {
  patientId: string;
  clientName: string;
}

interface Tool {
  title: string;
  note: string;
  render: (target: Target) => ReactNode;
  /** The component draws its own card and heading. */
  bare?: boolean;
}

interface FullPage {
  label: string;
  to: (patientId: string) => string;
}

interface ModuleDef {
  tools: Tool[];
  page?: FullPage;
}

/** This client's follow-ups, as the record's Follow-up stage shows them. */
function ClientFollowUps({ patientId, clientName }: Target) {
  const [version, setVersion] = useState(0);
  const { data, error } = useRecordData(
    patientId,
    version,
    (token) => getClientFollowUps(token, patientId),
    "Couldn't load this client's follow-up.",
  );
  return (
    <>
      <ErrorNote>{error}</ErrorNote>
      <FollowUpPanel
        patientId={patientId}
        clientName={clientName}
        data={data}
        onChanged={() => setVersion((v) => v + 1)}
      />
    </>
  );
}

/** Each intervention module opens the system's own module for this client —
 * the same components and pages the record and sidebar use, so each concept
 * keeps one store (CLAUDE.md §4). Pages outside the record open scoped to the
 * client: the record selects it in the shared patient context, and the
 * admissions page takes `?patient=`. Modules with no dedicated module yet
 * (medical review, psychosocial support, nutrition & fitness) record through
 * the delivery form only. */
const MODULES = new Map<string, ModuleDef>(
  Object.entries({
    emergency_care: {
      tools: [
        {
          title: "SBAR handover",
          note: "Built from the record",
          render: ({ patientId }: Target) => <SbarModule patientId={patientId} />,
        },
      ],
    },
    observation_safety: {
      tools: [
        {
          title: "Observation & safety",
          note: "Level, signed entries, observation sets + early warning score",
          render: ({ patientId }: Target) => <ObservationModule patientId={patientId} />,
        },
      ],
    },
    blood_work: {
      tools: [
        {
          title: "Blood work",
          note: "Order sets, result entry, abnormal-result acknowledgement",
          render: ({ patientId }: Target) => <LabsModule patientId={patientId} />,
        },
      ],
      page: { label: "Open Laboratory records", to: () => "/clinical/lims" },
    },
    appointments: {
      tools: [],
      page: {
        label: "Open this client's appointments",
        to: (patientId: string) => clientRecordPath(patientId, "follow-up"),
      },
    },
    psychiatry: {
      tools: [
        {
          title: "Medication orders",
          note: "Structured orders — allergy and duplicate checks run before the order is placed",
          render: ({ patientId }: Target) => <PrescribingModule patientId={patientId} />,
        },
      ],
      page: {
        label: "Open psychiatric assessment & diagnosis",
        to: (patientId: string) => clientRecordPath(patientId, "intake"),
      },
    },
    admission: {
      tools: [
        {
          title: "Legal admission status",
          note: "Voluntary / involuntary status, rights information, notices — as in Legal & consent",
          render: ({ patientId }: Target) => (
            <LegalAdmissionStatus patientId={patientId} onChanged={() => undefined} />
          ),
          bare: true,
        },
        {
          title: "Statutory forms",
          note: "Forms linked to legal status",
          render: ({ patientId }: Target) => <LegalFormsModule patientId={patientId} />,
        },
      ],
      page: {
        label: "Admit or view admission",
        to: (patientId: string) => `/clinical/inpatient?patient=${encodeURIComponent(patientId)}`,
      },
    },
    withdrawal_management: {
      tools: [
        {
          title: "Withdrawal chart",
          note: "CIWA-Ar / COWS serial chart, scoring and re-score due time",
          render: ({ patientId }: Target) => <WithdrawalModule patientId={patientId} />,
        },
      ],
    },
    opioid_agonist_therapy: {
      tools: [
        {
          title: "OAT & naloxone",
          note: "Opioid agonist therapy referral and naloxone",
          render: ({ patientId }: Target) => <OatModule patientId={patientId} />,
        },
      ],
    },
    psychiatric_nursing: {
      tools: [
        {
          title: "Medication administration (MAR)",
          note: "Today’s doses, PRN limits, controlled drugs, SBAR shift handover",
          render: ({ patientId }: Target) => <MarModule patientId={patientId} />,
        },
      ],
      page: {
        label: "Open Medication administration & nursing notes",
        to: () => "/clinical/ipd/nursing",
      },
    },
    restrictive_practice: {
      tools: [
        {
          title: "Restrictive practice",
          note: "De-escalation first, authoriser, timed checks, debrief",
          render: ({ patientId }: Target) => <RestrictiveModule patientId={patientId} />,
        },
      ],
    },
    group_psychotherapy: {
      tools: [],
      page: { label: "Open Group psychotherapy", to: () => "/clinical/psychotherapy/group" },
    },
    psychotherapy: {
      tools: [
        {
          title: "Therapy",
          note: "Therapy contract, numbered sessions, measurement-based care",
          render: ({ patientId }: Target) => <TherapyModule patientId={patientId} />,
        },
      ],
    },
    attachments: {
      tools: [
        {
          title: "Client documents",
          note: "Clinical documents, referrals and correspondence on this record",
          render: ({ patientId }: Target) => <DocumentLibrary patientId={patientId} />,
        },
      ],
    },
    discharge: {
      tools: [],
      page: {
        label: "Open this client's discharge",
        to: (patientId: string) => `${clientRecordPath(patientId, "outcomes")}?tab=discharge`,
      },
    },
    follow_up_aftercare: {
      tools: [
        {
          title: "Follow-up",
          note: "This client's follow-ups — the same list as the Follow-up stage and worklist",
          render: (target: Target) => <ClientFollowUps {...target} />,
        },
      ],
      page: {
        label: "Open this client's follow-up",
        to: (patientId: string) => clientRecordPath(patientId, "follow-up"),
      },
    },
  }),
);

export function ModuleTools({
  code,
  patientId,
  clientName,
}: {
  code: string;
  patientId: string;
  clientName: string;
}) {
  const def = MODULES.get(code);
  if (!def) return null;
  const { tools, page } = def;
  return (
    <div className="mt-4 flex flex-col gap-3">
      {tools.map((tool) =>
        tool.bare ? (
          <div key={tool.title}>{tool.render({ patientId, clientName })}</div>
        ) : (
          <Card
            key={tool.title}
            title={
              <span>
                {tool.title}
                <span className="ml-2 text-xs font-normal text-ink-500">{tool.note}</span>
              </span>
            }
          >
            {tool.render({ patientId, clientName })}
          </Card>
        ),
      )}
      {page && (
        <Link to={page.to(patientId)} className={`${BTN_GHOST} ${BTN_SM} self-start`}>
          {page.label} ↗
        </Link>
      )}
    </div>
  );
}
