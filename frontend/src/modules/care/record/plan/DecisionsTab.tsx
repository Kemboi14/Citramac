import { useState } from "react";
import { Check, Pencil, Trash2, X } from "lucide-react";
import { ConfirmDialog } from "../../../../components/ConfirmDialog";
import { RowActionsMenu, type RowAction } from "../../../../components/RowActionsMenu";
import { useAuth } from "../../../../auth/useAuth";
import {
  decidePlanAction,
  type PlanAction,
  type PlanPriority,
  type PlanWorkspace,
} from "../../../../lib/carePathwayApi";
import {
  acceptRemainingRecommendations,
  removeAddedAction,
} from "../../../../lib/carePlanOutcomesApi";
import { errorText } from "../../triage/helpers";
import { BTN, BTN_GHOST, BTN_SM, FIELD_LABEL, INPUT } from "../../shared/styles";
import { ErrorNote, Tag } from "../../shared/ui";
import { formatDate } from "../../shared/format";

const PRIORITY_ORDER: PlanPriority[] = ["RED", "ORANGE", "YELLOW", "GREEN"];
const PRIORITY_LABEL: Record<PlanPriority, string> = {
  RED: "Emergency",
  ORANGE: "Urgent",
  YELLOW: "Priority",
  GREEN: "Routine",
};
const DOT: Record<PlanPriority, string> = {
  RED: "bg-priority-red",
  ORANGE: "bg-priority-orange",
  YELLOW: "bg-priority-yellow",
  GREEN: "bg-priority-green",
};

const LIST =
  "max-w-[880px] divide-y divide-surface-border overflow-hidden rounded-xl border border-surface-border bg-surface-card";
const LINK =
  "text-[12.5px] font-semibold text-ink-500 transition-colors hover:text-ink-900 disabled:opacity-60";
const SECTION_HEAD = "mb-2 flex max-w-[880px] items-baseline justify-between gap-3";
const SECTION_TITLE = "text-[11px] font-bold uppercase tracking-[.5px] text-ink-500";

type Editor = { key: string; mode: "decline" | "modify" | "add" };

interface Row {
  key: string;
  name: string;
  recommended: PlanPriority | null;
  why: string[];
  act: PlanAction | undefined;
}

export function PriorityBadge({ priority }: { priority: PlanPriority }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-[12px] font-medium text-ink-700">
      <span aria-hidden="true" className={`h-2 w-2 rounded-full ${DOT[priority]}`} />
      {PRIORITY_LABEL[priority]}
    </span>
  );
}

/** The plan's actions: recommendations still to decide, then what is in the plan,
 * then what was declined. Each recommendation carries its provenance; lowering a
 * recommended priority, or declining, needs a written reason. */
function triageTaskStatus(status: string) {
  if (status === "COMPLETED") return "Done";
  if (status === "PENDING") return "In progress";
  return "Not started";
}

export function DecisionsTab({
  patientId,
  ws,
  onChange,
  disabled,
}: {
  patientId: string;
  ws: PlanWorkspace;
  onChange: (next: PlanWorkspace) => void;
  disabled: boolean;
}) {
  const { accessToken } = useAuth();
  const [error, setError] = useState<string | null>(null);
  const [editor, setEditor] = useState<Editor | null>(null);
  const [reason, setReason] = useState("");
  const [instructions, setInstructions] = useState("");
  const [priority, setPriority] = useState<PlanPriority>("GREEN");
  const [adding, setAdding] = useState("");
  const [busy, setBusy] = useState(false);
  const [removing, setRemoving] = useState<Row | null>(null);
  const [removeError, setRemoveError] = useState<string | null>(null);

  async function call(work: () => Promise<PlanWorkspace>, failure: string) {
    setError(null);
    setBusy(true);
    try {
      onChange(await work());
      setEditor(null);
      setAdding("");
      setReason("");
      setInstructions("");
      return true;
    } catch (e) {
      setError(errorText(e, failure));
      return false;
    } finally {
      setBusy(false);
    }
  }

  function decide(
    key: string,
    decision: "ACCEPTED" | "MODIFIED" | "ADDED" | "DECLINED",
    extra: { priority?: PlanPriority; reason?: string; instructions?: string } = {},
  ) {
    if (!accessToken) return Promise.resolve(false);
    return call(
      () => decidePlanAction(accessToken, patientId, key, { decision, ...extra }),
      "Couldn't save the decision.",
    );
  }

  function openEditor(next: Editor, start: PlanPriority, text = "") {
    setEditor(next);
    setPriority(start);
    setInstructions(text);
    setReason("");
    setError(null);
  }

  const acted = (key: string) => ws.actions.find((a) => a.key === key);
  const rank = (p: PlanPriority | "" | null) => (p ? PRIORITY_ORDER.indexOf(p) : 9);
  const recRows: Row[] = ws.recommendations.map((r) => ({
    key: r.key,
    name: r.name,
    recommended: r.priority,
    why: r.why,
    act: acted(r.key),
  }));
  const recKeys = new Set(ws.recommendations.map((r) => r.key));
  const addedRows: Row[] = ws.actions
    .filter((a) => !recKeys.has(a.key))
    .map((a) => ({
      key: a.key,
      name: a.name,
      recommended: null,
      why: a.decision === "ADDED" ? [] : a.why,
      act: a,
    }));
  const byPriority = (a: Row, b: Row) =>
    rank(a.act?.priority || a.recommended) - rank(b.act?.priority || b.recommended);

  const toDecide = recRows.filter((r) => !r.act).sort(byPriority);
  const inPlan = [...recRows, ...addedRows]
    .filter((r) => r.act && r.act.decision !== "DECLINED")
    .sort(byPriority);
  const declined = recRows.filter((r) => r.act?.decision === "DECLINED");
  const addable = ws.other_actions.filter((o) => !acted(o.key));

  function renderEditor(row: Row) {
    if (editor?.key !== row.key) return null;
    const lowered =
      row.recommended !== null &&
      PRIORITY_ORDER.indexOf(priority) > PRIORITY_ORDER.indexOf(row.recommended);
    const needsReason = editor.mode === "decline" || lowered;
    const submit = () => {
      if (editor.mode === "decline") return decide(row.key, "DECLINED", { reason });
      if (editor.mode === "add") return decide(row.key, "ADDED", { priority, instructions });
      return decide(row.key, priority === row.recommended ? "ACCEPTED" : "MODIFIED", {
        priority,
        instructions,
        reason,
      });
    };
    return (
      <div className="mt-3 flex flex-col gap-3 border-t border-surface-border pt-3">
        {editor.mode !== "decline" && (
          <>
            <div className="flex flex-col gap-1.5">
              <span className={FIELD_LABEL}>Priority</span>
              <div
                role="radiogroup"
                aria-label={`Priority for ${row.name}`}
                className="inline-flex w-fit overflow-hidden rounded-lg border border-surface-border"
              >
                {PRIORITY_ORDER.map((p) => (
                  <button
                    key={p}
                    type="button"
                    role="radio"
                    aria-checked={priority === p}
                    onClick={() => setPriority(p)}
                    className={`flex items-center gap-1.5 border-r border-surface-border px-3 py-1.5 text-[12.5px] font-medium last:border-r-0 ${priority === p ? "bg-ink-900 text-surface-card" : "bg-surface-card text-ink-700 hover:bg-surface-bg"}`}
                  >
                    <span aria-hidden="true" className={`h-2 w-2 rounded-full ${DOT[p]}`} />
                    {PRIORITY_LABEL[p]}
                  </button>
                ))}
              </div>
            </div>
            <label className="flex flex-col gap-1.5">
              <span className={FIELD_LABEL}>Instructions (optional)</span>
              <input
                className={INPUT}
                placeholder="e.g. review within the hour; family present"
                value={instructions}
                onChange={(e) => setInstructions(e.target.value)}
              />
            </label>
          </>
        )}
        {needsReason && (
          <label className="flex flex-col gap-1.5">
            <span className={FIELD_LABEL}>
              {editor.mode === "decline"
                ? "Reason for declining"
                : `Reason for a lower priority than recommended (${PRIORITY_LABEL[row.recommended as PlanPriority]})`}{" "}
              <span className="text-priority-red">*</span>
            </span>
            <input
              className={INPUT}
              value={reason}
              autoFocus
              onChange={(e) => setReason(e.target.value)}
            />
          </label>
        )}
        <div className="flex gap-2">
          <button
            type="button"
            className={`${BTN} ${BTN_SM}`}
            disabled={busy || (needsReason && !reason.trim())}
            onClick={() => void submit()}
          >
            {editor.mode === "decline"
              ? "Decline"
              : editor.mode === "add" && !row.act
                ? "Add to plan"
                : "Save"}
          </button>
          <button
            type="button"
            className={`${BTN_GHOST} ${BTN_SM}`}
            onClick={() => {
              setEditor(null);
              setAdding("");
            }}
          >
            Cancel
          </button>
        </div>
      </div>
    );
  }

  function rowActions(row: Row, state: "decide" | "plan" | "declined"): RowAction[] {
    const act = row.act;
    if (state === "decide") {
      return [
        {
          label: "Accept with changes…",
          icon: <Pencil aria-hidden className="h-4 w-4 text-ink-500" />,
          onSelect: () => openEditor({ key: row.key, mode: "modify" }, row.recommended!),
        },
        {
          label: "Decline…",
          icon: <X aria-hidden className="h-4 w-4" />,
          tone: "danger",
          onSelect: () => openEditor({ key: row.key, mode: "decline" }, row.recommended!),
        },
      ];
    }
    if (state === "declined") {
      return [
        {
          label: "Accept instead",
          icon: <Check aria-hidden className="h-4 w-4 text-ink-500" />,
          onSelect: () => void decide(row.key, "ACCEPTED"),
        },
      ];
    }
    const signed = Boolean(act?.due_at);
    const out: RowAction[] = [
      {
        label: "Edit",
        icon: <Pencil aria-hidden className="h-4 w-4 text-ink-500" />,
        onSelect: () =>
          openEditor(
            { key: row.key, mode: act?.decision === "ADDED" ? "add" : "modify" },
            (act?.priority || row.recommended || "GREEN") as PlanPriority,
            act?.instructions ?? "",
          ),
      },
      {
        label: "Remove",
        icon: <Trash2 aria-hidden className="h-4 w-4" />,
        tone: "danger",
        disabledReason: signed
          ? "Part of the signed plan — record its outcome in Interventions"
          : undefined,
        onSelect: () => {
          setRemoveError(null);
          setRemoving(row);
        },
      },
    ];
    return out;
  }

  async function confirmRemove() {
    if (!accessToken || !removing) return;
    setRemoveError(null);
    setBusy(true);
    try {
      onChange(await removeAddedAction(accessToken, patientId, removing.key));
      setRemoving(null);
    } catch (e) {
      setRemoveError(errorText(e, "Couldn't remove the action."));
    } finally {
      setBusy(false);
    }
  }

  function renderRow(row: Row, state: "decide" | "plan" | "declined") {
    const act = row.act;
    const shown = (act?.priority || row.recommended) as PlanPriority | null;
    const modified = act?.decision === "MODIFIED";
    return (
      <li key={row.key} data-action-key={row.key} className="px-4 py-2.5">
        <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <span
                className={`text-[13.5px] font-semibold ${state === "declined" ? "text-ink-500 line-through decoration-ink-300" : "text-ink-900"}`}
              >
                {row.name}
              </span>
              {state === "decide" && row.recommended && (
                <Tag>recommended · {PRIORITY_LABEL[row.recommended]}</Tag>
              )}
              {state === "plan" && shown && act?.decision !== "ADDED" && (
                <Tag>recommended · {PRIORITY_LABEL[shown]}</Tag>
              )}
              {state === "plan" && shown && act?.decision === "ADDED" && (
                <PriorityBadge priority={shown} />
              )}
              {state === "plan" && modified && row.recommended && (
                <span className="text-[12px] text-ink-500">
                  changed from {PRIORITY_LABEL[row.recommended]}
                </span>
              )}
              {act?.triage_tasks?.length ? (
                <span className="text-[12px] text-ink-500">started at triage</span>
              ) : (
                act?.decision === "ADDED" && (
                  <span className="text-[12px] text-ink-500">added by clinician</span>
                )
              )}
              {act?.bulk_accepted && (
                <span className="text-[12px] text-ink-500">accepted in bulk</span>
              )}
            </div>
            {row.why.length > 0 && (
              <ul className="mt-1 flex flex-col gap-0.5 text-[12.5px] text-ink-500">
                {row.why.map((w) => (
                  <li key={w}>{w}</li>
                ))}
              </ul>
            )}
            {state === "plan" && act?.triage_tasks && act.triage_tasks.length > 0 && (
              <ul className="mt-1 flex flex-col gap-0.5 text-[12.5px] text-ink-700">
                {act.triage_tasks.map((t) => (
                  <li key={t.id}>
                    {t.label} · assigned to {t.assignee} ·{" "}
                    <span className="text-ink-500">{triageTaskStatus(t.status)}</span>
                  </li>
                ))}
              </ul>
            )}
            {act?.instructions && state === "plan" && act.decision !== "ADDED" && (
              <p className="mt-1 text-[12.5px] text-ink-700">
                <span className="text-ink-500">Instructions: </span>
                {act.instructions}
              </p>
            )}
            {state === "declined" && act?.reason && (
              <p className="mt-1 text-[12.5px] text-ink-500">“{act.reason}”</p>
            )}
          </div>
          {!disabled && editor?.key !== row.key && (
            <div className="flex shrink-0 items-center gap-1">
              {state === "decide" && (
                <button
                  type="button"
                  className="rounded-md border border-brand-green bg-brand-green px-3 py-1 text-[12px] font-semibold text-on-primary hover:bg-brand-green-dark disabled:opacity-60"
                  disabled={busy}
                  onClick={() => void decide(row.key, "ACCEPTED")}
                >
                  Accept
                </button>
              )}
              <RowActionsMenu label={`Actions for ${row.name}`} actions={rowActions(row, state)} />
            </div>
          )}
        </div>
        {renderEditor(row)}
      </li>
    );
  }

  const addRow: Row | null = adding
    ? {
        key: adding,
        name: addable.find((o) => o.key === adding)?.name ?? adding,
        recommended: null,
        why: [],
        act: undefined,
      }
    : null;

  return (
    <div className="flex flex-col gap-7">
      <ErrorNote>{error}</ErrorNote>
      {ws.carried_scores.length > 0 && (
        <section aria-labelledby="plan-scores">
          <h3 id="plan-scores" className={`${SECTION_TITLE} mb-2`}>
            Assessment results — carried automatically
          </h3>
          <ul className="flex flex-wrap gap-1.5">
            {ws.carried_scores.map((c) => (
              <li
                key={c.instrument}
                className="rounded-full border border-surface-border bg-surface-card px-3 py-1 text-[12.5px] text-ink-900"
              >
                <strong className="font-semibold">{c.name}</strong> {c.score}/{c.max}
                {c.band ? ` · ${c.band}` : ""} · {formatDate(c.at)}
                {c.approval === "illustrative" && (
                  <span className="text-ink-500"> (illustrative bands)</span>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      {toDecide.length > 0 && (
        <section aria-labelledby="plan-to-decide">
          <div className={SECTION_HEAD}>
            <h3 id="plan-to-decide" className={SECTION_TITLE}>
              To decide · {toDecide.length}
            </h3>
            {!disabled && toDecide.length > 1 && (
              <button
                type="button"
                className={LINK}
                disabled={busy}
                title="Bulk-accepted actions are listed again at signing for you to confirm."
                onClick={() =>
                  accessToken &&
                  void call(
                    () => acceptRemainingRecommendations(accessToken, patientId),
                    "Couldn't accept the recommendations.",
                  )
                }
              >
                Accept all as recommended
              </button>
            )}
          </div>
          <ul className={LIST}>{toDecide.map((r) => renderRow(r, "decide"))}</ul>
        </section>
      )}

      <section aria-labelledby="plan-in-plan">
        <div className={SECTION_HEAD}>
          <h3 id="plan-in-plan" className={SECTION_TITLE}>
            In the plan · {inPlan.length}
          </h3>
        </div>
        {inPlan.length === 0 ? (
          <p className="max-w-[880px] rounded-xl border border-dashed border-surface-border px-4 py-5 text-center text-[13px] text-ink-500">
            No actions yet. Accept a recommendation or add an action below.
          </p>
        ) : (
          <ul className={LIST}>{inPlan.map((r) => renderRow(r, "plan"))}</ul>
        )}
        {!disabled && addable.length > 0 && (
          <div className="mt-3">
            {addRow ? (
              <ul>
                <li className="max-w-[880px] rounded-xl border border-surface-border bg-surface-card px-4 py-3">
                  <span className="text-[14px] font-semibold text-ink-900">{addRow.name}</span>
                  {renderEditor(addRow)}
                </li>
              </ul>
            ) : (
              <label className="flex flex-wrap items-center gap-2">
                <span className="sr-only">Add an action</span>
                <select
                  className={`${INPUT} !w-auto min-w-[240px]`}
                  value=""
                  onChange={(e) => {
                    if (!e.target.value) return;
                    setAdding(e.target.value);
                    openEditor({ key: e.target.value, mode: "add" }, ws.suggested_priority);
                  }}
                >
                  <option value="">+ Add an action…</option>
                  {addable.map((o) => (
                    <option key={o.key} value={o.key}>
                      {o.name}
                    </option>
                  ))}
                </select>
              </label>
            )}
          </div>
        )}
      </section>

      {declined.length > 0 && (
        <section aria-labelledby="plan-declined">
          <div className={SECTION_HEAD}>
            <h3 id="plan-declined" className={SECTION_TITLE}>
              Declined · {declined.length}
            </h3>
          </div>
          <ul className={LIST}>{declined.map((r) => renderRow(r, "declined"))}</ul>
        </section>
      )}
      <ConfirmDialog
        open={removing !== null}
        title="Are you sure you want to remove this care plan?"
        confirmLabel="Remove"
        busyLabel="Removing…"
        tone="danger"
        busy={busy}
        error={removeError}
        onConfirm={() => void confirmRemove()}
        onCancel={() => setRemoving(null)}
        compact
      >
        <p>
          {removing?.recommended
            ? "It returns to “To decide” for you to accept or decline before signing."
            : "You can add it again at any time from “Add an action”."}
        </p>
      </ConfirmDialog>
    </div>
  );
}
