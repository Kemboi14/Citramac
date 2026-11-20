import { Check, ChevronDown, CircleDot } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router-dom";
import {
  PRIORITY_LABEL,
  type InterventionAction,
  type Priority,
} from "../../../../lib/carePathwayApi";
import { formatDate } from "../../shared/format";
import { clientReportPath } from "../../shared/recordRoutes";
import { BTN, BTN_GHOST, BTN_SM } from "../../shared/styles";
import { Card } from "../../shared/ui";

/** Where an action's records are listed in the client report. */
function recordsList(modules: string[]) {
  if (modules.includes("family_psychotherapy")) return { tab: "interventions", filter: "family" };
  if (modules.includes("psychotherapy")) return { tab: "interventions", filter: "psychotherapy" };
  if (modules.includes("psychiatry")) return { tab: "interventions", filter: "psychiatry" };
  return { tab: "interventions", filter: "care-plan" };
}

/** The origin line, said once ("Added by clinician · Added by clinician" read twice). */
function origin(action: InterventionAction) {
  const parts = [action.decision_display, action.why].filter(Boolean);
  const unique = parts.filter(
    (part, i) => parts.findIndex((p) => p.toLowerCase() === part.toLowerCase()) === i,
  );
  const text = unique.join(" · ").toLowerCase();
  return text ? text[0].toUpperCase() + text.slice(1) : "";
}

/** "Care-plan actions — what the plan asked for" (v4 `stageInterventions`):
 * each action with where it is delivered, its priority, due date, status and
 * the latest delivery. Sorted most
 * urgent first by the server; corrected deliveries are not counted. */
const PRIORITY_TAG: Record<string, string> = {
  RED: "bg-priority-red-tint text-priority-red",
  ORANGE: "bg-priority-orange-tint text-priority-orange",
  YELLOW: "bg-priority-yellow-tint text-priority-yellow",
  GREEN: "bg-priority-green-tint text-priority-green",
};

const PRIORITY_DOT: Record<string, string> = {
  RED: "bg-priority-red-solid",
  ORANGE: "bg-priority-orange",
  YELLOW: "bg-priority-yellow-solid",
  GREEN: "bg-priority-green-solid",
};

function StatusIcon({ status }: { status: string }) {
  if (status === "COMPLETED") {
    return (
      <span className="grid h-6 w-6 flex-none place-items-center rounded-full bg-priority-green-solid text-white">
        <Check aria-hidden className="h-3.5 w-3.5" />
      </span>
    );
  }
  if (status === "PLANNED" || status === "SCHEDULED") {
    return <span className="h-6 w-6 flex-none rounded-full border-2 border-surface-border" />;
  }
  return (
    <span className="grid h-6 w-6 flex-none place-items-center rounded-full bg-priority-orange-tint text-priority-orange">
      <CircleDot aria-hidden className="h-3.5 w-3.5" />
    </span>
  );
}

/** The care plan's actions as a work list: one row per action — its status,
 * what it is and where it is delivered, its priority, progress so far and the
 * due date when set — with Open going straight to the module that delivers it.
 * Sorted most urgent first by the server; corrected deliveries are not counted. */
export function CarePlanActionsTable({
  actions,
  loading,
  moduleNames = {},
  patientId,
  onOpen,
}: {
  actions: InterventionAction[];
  loading: boolean;
  /** Module code → name, to say which module delivers each action. */
  moduleNames?: Record<string, string>;
  /** The client, for links to where the records are. */
  patientId: string;
  /** Open the module that delivers this action. */
  onOpen?: (moduleCode: string) => void;
}) {
  if (actions.length === 0) {
    return (
      <Card>
        <p className="py-2 text-center text-[13px] text-ink-500">
          {loading ? "Loading care plan…" : "No care-plan actions documented yet."}
        </p>
      </Card>
    );
  }
  return (
    <Card bodyClassName="p-0">
      <ul className="divide-y divide-surface-border">
        {actions.map((action) => (
          <ActionRow
            key={action.id}
            action={action}
            moduleNames={moduleNames}
            patientId={patientId}
            onOpen={onOpen}
          />
        ))}
      </ul>
    </Card>
  );
}

/** At a glance: status, title, priority dot, a short progress word and Open.
 * The rest (where it is delivered, why, instructions, note, due date, records)
 * opens under the row on demand. */
function ActionRow({
  action,
  moduleNames,
  patientId,
  onOpen,
}: {
  action: InterventionAction;
  moduleNames: Record<string, string>;
  patientId: string;
  onOpen?: (moduleCode: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const from = origin(action);
  const through = action.modules.map((code) => moduleNames[code]).filter(Boolean);
  const progress = action.overdue
    ? "Overdue"
    : action.latest_at
      ? `${action.records} · ${formatDate(action.latest_at)}`
      : action.status === "COMPLETED"
        ? "Done"
        : "Not started";
  const details: [string, string][] = [
    ["Delivered through", through.join(", ")],
    ["Why", from],
    ["Instructions", action.instructions],
    ["Due", action.due_at ? formatDate(action.due_at) : ""],
    [
      "Last delivery",
      action.latest_at
        ? `${formatDate(action.latest_at)} · ${action.latest_by || "—"} · ${action.records} ${
            action.records === 1 ? "record" : "records"
          }${action.group_records ? ` (${action.group_records} group)` : ""}`
        : "",
    ],
    [
      "Care-plan note",
      action.note ? `${action.note.text} — ${action.note.author || "Clinician"}` : "",
    ],
  ];
  return (
    <li>
      <div className="flex items-center gap-3 px-4 py-2.5">
        <StatusIcon status={action.status} />
        <button
          type="button"
          aria-expanded={open}
          onClick={() => setOpen((value) => !value)}
          className="min-w-0 flex-1 truncate text-left text-[14px] font-semibold text-ink-900 hover:text-accent-info hover:underline"
        >
          {action.title}
        </button>
        <span className="hidden w-40 sm:block">
          {action.priority && (
            <span
              className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11.5px] font-semibold ${
                PRIORITY_TAG[action.priority] ?? "bg-surface-bg text-ink-700"
              }`}
            >
              <span
                aria-hidden
                className={`h-1.5 w-1.5 rounded-full ${PRIORITY_DOT[action.priority] ?? "bg-ink-400"}`}
              />
              {action.priority.charAt(0) + action.priority.slice(1).toLowerCase()}
              {PRIORITY_LABEL[action.priority as Priority]
                ? ` · ${PRIORITY_LABEL[action.priority as Priority]}`
                : ""}
            </span>
          )}
        </span>
        <span
          className={`hidden w-28 whitespace-nowrap text-[12.5px] md:block ${
            action.overdue ? "font-semibold text-priority-red" : "text-ink-500"
          }`}
        >
          {progress}
        </span>
        {onOpen && action.modules[0] ? (
          <button
            type="button"
            className={`${action.status === "COMPLETED" ? BTN_GHOST : BTN} ${BTN_SM}`}
            onClick={() => onOpen(action.modules[0])}
          >
            Open
          </button>
        ) : (
          <span className="w-[58px]" />
        )}
        <button
          type="button"
          aria-label={open ? "Hide details" : "Show details"}
          aria-expanded={open}
          onClick={() => setOpen((value) => !value)}
          className="grid h-8 w-8 flex-none place-items-center rounded-md text-ink-400 hover:bg-surface-bg hover:text-ink-900"
        >
          <ChevronDown
            aria-hidden
            className={`h-4 w-4 transition-transform ${open ? "rotate-180" : ""}`}
          />
        </button>
      </div>
      {open && (
        <div className="bg-surface-bg px-4 pb-3 pl-[52px] pt-2">
          <dl className="grid gap-x-6 gap-y-1.5 text-[12.5px] sm:grid-cols-[140px_minmax(0,1fr)]">
            {details
              .filter(([, value]) => value)
              .map(([label, value]) => (
                <div key={label} className="contents">
                  <dt className="text-ink-500">{label}</dt>
                  <dd className="whitespace-pre-wrap text-ink-900">{value}</dd>
                </div>
              ))}
          </dl>
          {action.records > 0 && (
            <Link
              to={clientReportPath(patientId, recordsList(action.modules))}
              className="mt-2 inline-block text-[12.5px] font-semibold text-brand-green hover:underline"
            >
              See the records →
            </Link>
          )}
        </div>
      )}
    </li>
  );
}
