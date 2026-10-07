import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { Printer } from "lucide-react";
import { useAuth } from "../../auth/useAuth";
import { ApiError } from "../../lib/apiClient";
import { getSignedAssessment, type TriageAssessmentRecord } from "../../lib/carePathwayApi";
import { formatDateTime } from "./shared/format";
import { clientRecordPath } from "./shared/recordRoutes";
import { BTN, BTN_GHOST, FIELD_LABEL, TABLE, TD, TH } from "./shared/styles";
import { Callout, Card, ErrorNote, PageHeader, PriorityPill, Tag } from "./shared/ui";

// Read-only rendering of one signed triage assessment (doc 15 §1.6 "The signed
// record holds…", §1.14 Documents → View). Coded answers are translated through
// the served labels the API returns with the record (`payload.labels`, keyed
// "valuesetId:code"); nothing here hard-codes a display for a code.

type SignedAssessment = TriageAssessmentRecord & {
  patient_id: string;
  name: string;
  labels: Record<string, string>;
};

const SECTION_TITLES: [string, string][] = [
  ["a", "A — Automatic Information"],
  ["b", "B — Triage Encounter"],
  ["c", "C — What Is Happening Right Now?"],
  ["d", "D — Immediate Safety: Suicide / Self-Harm"],
  ["e", "E — Risk of Harm to Others"],
  ["f", "F — Acute Mental State"],
  ["g", "G — Alcohol & Other Substances"],
  ["h", "H — Urgent Medical Screen"],
  ["i", "I — Safeguarding & Vulnerability"],
  ["j", "J — Immediate Functional Safety"],
  ["k", "K — Client Not Physically Present: Telephone / Third-Party Screen"],
  ["l", "L — Automatic Triage Summary"],
  ["m", "M — Triage Priority"],
  ["n", "N — Immediate Action / Disposition"],
];

// Yes/No-family value sets (backend valuesets.py) — tried in turn for items
// whose answer is a yes/no/unknown-style code.
const YES_NO_FAMILY = [
  "no-yes-unable",
  "no-yes-unknown",
  "no-yes-uncertain",
  "yes-no-uncertain",
  "yes-no-unknown",
  "no-yes-unsure",
  "no-yes",
  "yes-no",
];

/** Item code → question wording (doc 15 §1.6) and the value set its answer is coded in. */
const ITEMS = new Map<string, { label: string; valuesets?: string[] }>([
  ["a_allergy_status", { label: "Allergy status", valuesets: ["triage-allergy-status"] }],
  ["a_allergy_detail", { label: "Allergy detail" }],
  ["b_third_party", { label: "Name / relationship if third party" }],
  ["b_encounter_type", { label: "Encounter type", valuesets: ["triage-encounter-type"] }],
  ["b_informant", { label: "Who is providing the information?", valuesets: ["triage-informant"] }],
  ["b_present", { label: "Is the client physically present?", valuesets: YES_NO_FAMILY }],
  ["c_concern", { label: "Main concern in the client's or informant's own words" }],
  ["c_onset", { label: "When did this begin or become worse?", valuesets: ["triage-onset"] }],
  ["c_description", { label: "Brief description" }],
  [
    "d_suicidal",
    {
      label: "Currently having thoughts of killing or seriously harming yourself?",
      valuesets: YES_NO_FAMILY,
    },
  ],
  [
    "d_act_now",
    { label: "Thinking about acting on these thoughts now?", valuesets: YES_NO_FAMILY },
  ],
  [
    "d_attempt",
    {
      label: "Anything recently done to kill or seriously harm yourself?",
      valuesets: YES_NO_FAMILY,
    },
  ],
  ["d_means", { label: "Known access to means of serious self-harm?", valuesets: YES_NO_FAMILY }],
  [
    "d_safety",
    { label: "Can the client currently maintain their own safety?", valuesets: YES_NO_FAMILY },
  ],
  ["d_what_happened", { label: "What happened and when?" }],
  [
    "e_thoughts",
    { label: "Current thoughts of seriously harming someone else?", valuesets: YES_NO_FAMILY },
  ],
  [
    "e_behaviour",
    {
      label: "Recent threatening, aggressive or violent behaviour?",
      valuesets: YES_NO_FAMILY,
    },
  ],
  ["e_act", { label: "Recent violent act?", valuesets: YES_NO_FAMILY }],
  ["e_means", { label: "Known access to means of serious harm?", valuesets: YES_NO_FAMILY }],
  ["e_danger", { label: "Current behaviour suggests immediate danger?", valuesets: YES_NO_FAMILY }],
  ["e_concern", { label: "Who/what is the concern?" }],
  ["f_change", { label: "Major change in mental state now?", valuesets: YES_NO_FAMILY }],
  ["f_features", { label: "Observed features", valuesets: ["triage-mental-state-feature"] }],
  ["f_consciousness", { label: "Level of consciousness", valuesets: ["triage-consciousness"] }],
  ["f_orientation", { label: "Orientation", valuesets: ["triage-orientation"] }],
  ["f_behaviour", { label: "Behaviour", valuesets: ["triage-behaviour"] }],
  ["f_observation", { label: "Clinician observation" }],
  ["g_use", { label: "Recent alcohol or other substance use?", valuesets: YES_NO_FAMILY }],
  ["g_intoxication", { label: "Current intoxication", valuesets: ["triage-intoxication"] }],
  ["g_stopped", { label: "Recently stopped or reduced heavy use?", valuesets: YES_NO_FAMILY }],
  ["g_seizure", { label: "Previous withdrawal seizure?", valuesets: YES_NO_FAMILY }],
  [
    "g_withdrawal",
    { label: "Current withdrawal symptoms", valuesets: ["triage-withdrawal-symptom"] },
  ],
  ["h_concern", { label: "Immediate physical/medical concern?", valuesets: YES_NO_FAMILY }],
  ["h_flags", { label: "Immediate concerns", valuesets: ["triage-medical-concern"] }],
  ["h_bp", { label: "BP" }],
  ["h_pulse", { label: "Pulse" }],
  ["h_rr", { label: "Resp. rate" }],
  ["h_temp", { label: "Temp" }],
  ["h_spo2", { label: "SpO₂" }],
  ["h_glucose", { label: "Blood glucose" }],
  [
    "i_safe",
    {
      label: "Do you feel safe where you currently live or stay?",
      valuesets: ["triage-feels-safe"],
    },
  ],
  ["i_flags", { label: "Concerns", valuesets: ["triage-safeguarding-concern"] }],
  ["i_return", { label: "Safe to return to current environment?", valuesets: YES_NO_FAMILY }],
  [
    "j_concern",
    {
      label: "Immediate concern that the person cannot safely care for basic needs?",
      valuesets: YES_NO_FAMILY,
    },
  ],
  ["j_flags", { label: "Areas", valuesets: ["triage-functional-area"] }],
  ["k_where", { label: "Where is the client now?" }],
  ["k_alone", { label: "Are they alone?", valuesets: YES_NO_FAMILY }],
  ["k_with", { label: "Who is physically with them?" }],
  ["k_last_seen", { label: "When did the caller last see or speak with them?" }],
  ["k_cause", { label: "What exactly is causing concern?" }],
  [
    "k_bring",
    { label: "Can the person be brought safely for assessment?", valuesets: YES_NO_FAMILY },
  ],
  ["k_emergency", { label: "Is emergency assistance required?", valuesets: YES_NO_FAMILY }],
  ["k_flags", { label: "Concern reported", valuesets: ["triage-telephone-concern"] }],
  ["n_actions", { label: "Actions", valuesets: ["triage-action"] }],
  ["n_owner", { label: "Responsible person/team" }],
  ["n_status", { label: "Status", valuesets: ["task-status"] }],
]);

const ITEM_ORDER = [...ITEMS.keys()];

/** "k_last_seen" → "Last seen", for an item this page has no wording for. */
function humanise(key: string) {
  const words = key.replace(/^[a-n]_/, "").replace(/_/g, " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
}

function translate(labels: Map<string, string>, valuesets: string[] | undefined, code: string) {
  for (const vs of valuesets ?? []) {
    const display = labels.get(`${vs}:${code}`);
    if (display) return display;
  }
  return code;
}

interface AnswerLine {
  key: string;
  label: string;
  value: string;
}

function groupAnswers(record: SignedAssessment) {
  const labels = new Map(Object.entries(record.labels ?? {}));
  const sections = new Map<string, AnswerLine[]>();
  const keys = Object.keys(record.answers ?? {}).sort((a, b) => {
    const ia = ITEM_ORDER.indexOf(a);
    const ib = ITEM_ORDER.indexOf(b);
    if (ia === -1 && ib === -1) return a.localeCompare(b);
    if (ia === -1) return 1;
    if (ib === -1) return -1;
    return ia - ib;
  });
  const answers = new Map(Object.entries(record.answers ?? {}));
  for (const key of keys) {
    const raw = answers.get(key);
    const letter = /^([a-n])_/.exec(key)?.[1];
    if (!letter || raw === undefined || raw === null) continue;
    const item = ITEMS.get(key);
    let value: string;
    if (Array.isArray(raw)) {
      const parts = raw.filter((code) => String(code).trim() !== "");
      if (parts.length === 0) continue;
      value = parts.map((code) => translate(labels, item?.valuesets, String(code))).join(", ");
    } else {
      const text = String(raw).trim();
      if (!text) continue;
      value = item?.valuesets ? translate(labels, item.valuesets, text) : text;
    }
    const lines = sections.get(letter) ?? [];
    lines.push({ key, label: item?.label ?? humanise(key), value });
    sections.set(letter, lines);
  }
  return sections;
}

export function SignedTriageDocumentPage() {
  const { assessmentId } = useParams<{ assessmentId: string }>();
  const { accessToken } = useAuth();
  const [record, setRecord] = useState<SignedAssessment | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!accessToken || !assessmentId) return;
    let cancelled = false;
    getSignedAssessment(accessToken, assessmentId)
      .then((data) => !cancelled && setRecord(data))
      .catch(
        (err) =>
          !cancelled &&
          setError(
            err instanceof ApiError ? err.message : "Couldn't load this signed triage assessment.",
          ),
      );
    return () => {
      cancelled = true;
    };
  }, [accessToken, assessmentId]);

  if (error) {
    return (
      <div className="animate-fade-in">
        <PageHeader eyebrow="Clinical records" title="Signed triage assessment" />
        <ErrorNote>{error}</ErrorNote>
        <Link to="/clinical/documents" className={`${BTN_GHOST} mt-4`}>
          Back to documents
        </Link>
      </div>
    );
  }
  if (!record) {
    return <p className="text-sm text-ink-500">Loading signed triage assessment…</p>;
  }

  const labels = new Map(Object.entries(record.labels ?? {}));
  const sections = groupAnswers(record);
  const taskStatus = (code: string) => labels.get(`task-status:${code}`) ?? code;

  return (
    <div className="animate-fade-in">
      <PageHeader
        eyebrow={`Clinical records · Signed triage assessment${record.version > 1 ? ` · v${record.version}` : ""}`}
        title={record.name || "Unknown client"}
        subtitle={
          <span className="inline-flex flex-wrap items-center gap-x-2 gap-y-1">
            <PriorityPill priority={record.final_priority} long />
            <span>
              Signed by {record.signed_by || "Clinician not recorded"} ·{" "}
              {formatDateTime(record.signed_at)}
            </span>
            {record.rules_version && <Tag>Rules {record.rules_version}</Tag>}
          </span>
        }
        actions={
          <div className="flex flex-wrap gap-2 print:hidden">
            <Link to="/clinical/documents" className={BTN_GHOST}>
              Back to documents
            </Link>
            <button type="button" className={BTN_GHOST} onClick={() => window.print()}>
              <Printer size={14} aria-hidden="true" /> Print
            </button>
            <Link to={clientRecordPath(record.patient_id, "intake")} className={BTN}>
              Open record
            </Link>
          </div>
        }
      />

      <div className="grid gap-4">
        <Card title="Recommendation">
          <div className="grid gap-3">
            <div>
              <div className={FIELD_LABEL}>System recommendation</div>
              <div className="mt-1 text-[13px] font-semibold text-ink-900">
                {record.recommendation || "Not recorded"}
              </div>
              {record.recommendation_reasons && (
                <div className="mt-0.5 text-[12.5px] text-ink-700">
                  {record.recommendation_reasons}
                </div>
              )}
            </div>
            {record.alerts.length > 0 && (
              <div>
                <div className={FIELD_LABEL}>Alerts</div>
                <div className="mt-1 flex flex-wrap gap-1.5">
                  {record.alerts.map((alert) => (
                    <Tag key={alert.code} tone="risk">
                      {alert.label}
                    </Tag>
                  ))}
                </div>
              </div>
            )}
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <div className={FIELD_LABEL}>Clinician decision</div>
                <div className="mt-1 text-[13px] text-ink-900">
                  {record.decision === "OVERRIDE"
                    ? "Override"
                    : record.decision === "CONFIRM"
                      ? "Confirm recommendation"
                      : "Not recorded"}
                </div>
              </div>
              <div>
                <div className={FIELD_LABEL}>Final selected priority</div>
                <div className="mt-1">
                  <PriorityPill priority={record.final_priority} long />
                </div>
              </div>
            </div>
            {record.decision === "OVERRIDE" && (
              <Callout tone="warning">
                <strong>Reason for override:</strong>{" "}
                {record.override_reason || "No reason recorded"}
              </Callout>
            )}
          </div>
        </Card>

        <Card title="L — Automatic Triage Summary" bodyClassName="p-0 overflow-x-auto">
          <table className={`${TABLE} min-w-[560px]`}>
            <thead>
              <tr>
                <th className={TH}>Finding / Alert</th>
                <th className={TH}>Current status</th>
                <th className={TH}>Source</th>
              </tr>
            </thead>
            <tbody>
              {record.findings.length > 0 ? (
                record.findings.map(([finding, status, source], index) => (
                  <tr key={`${finding}-${index}`}>
                    <td className={TD}>{finding}</td>
                    <td className={TD}>{status}</td>
                    <td className={TD}>{source}</td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={3} className={`${TD} !p-6 text-center !text-ink-500`}>
                    No structured findings were recorded.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </Card>

        <Card title="Registered tasks" bodyClassName="p-0 overflow-x-auto">
          <table className={`${TABLE} min-w-[560px]`}>
            <thead>
              <tr>
                <th className={TH}>Action</th>
                <th className={TH}>Owner</th>
                <th className={TH}>Status</th>
                <th className={TH}>Date / time</th>
              </tr>
            </thead>
            <tbody>
              {record.tasks.length > 0 ? (
                record.tasks.map((task, index) => (
                  <tr key={`${task.action_label}-${index}`}>
                    <td className={TD}>{task.action_label}</td>
                    <td className={TD}>{task.owner}</td>
                    <td className={TD}>{taskStatus(task.status)}</td>
                    <td className={`${TD} whitespace-nowrap`}>{formatDateTime(task.created_at)}</td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={4} className={`${TD} !p-6 text-center !text-ink-500`}>
                    No tasks were registered with this triage.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </Card>

        {SECTION_TITLES.filter(([letter]) => sections.has(letter)).map(([letter, title]) => (
          <Card key={letter} title={title}>
            <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
              {(sections.get(letter) ?? []).map((line) => (
                <div key={line.key} className="min-w-0">
                  <dt className={FIELD_LABEL}>{line.label}</dt>
                  <dd className="mt-0.5 whitespace-pre-wrap break-words text-[13px] text-ink-900">
                    {line.value}
                  </dd>
                </div>
              ))}
            </dl>
          </Card>
        ))}
      </div>
    </div>
  );
}
