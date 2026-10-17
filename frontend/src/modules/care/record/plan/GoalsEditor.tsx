import { useState } from "react";
import type { PlanGoal, PlanWorkspace } from "../../../../lib/carePathwayApi";
import { BTN_GHOST, BTN_SM, FIELD_LABEL, INPUT } from "../../shared/styles";
import { SelectChoices } from "../../shared/ui";
import { useValueSets } from "../../shared/useValueSets";

const BLANK: PlanGoal = { goal: "", action_key: "", formulation: "", owner: "", review_date: "", source: "" };

/** My goals — in the client's words, each linked to a plan action and a 5P
 * formulation heading, with an owner and a review date (FHIR Goal). Edits are
 * kept locally and saved when a field is left. */
export function GoalsEditor({
  ws,
  disabled,
  onSave,
}: {
  ws: PlanWorkspace;
  disabled: boolean;
  onSave: (goals: PlanGoal[]) => void;
}) {
  const vs = useValueSets();
  const [goals, setGoals] = useState<PlanGoal[]>(ws.details.goal_items);
  const live = ws.actions.filter((a) => a.decision && a.decision !== "DECLINED");
  const intakeGoal = ws.intake.goals.trim();
  const fromIntake = intakeGoal && !goals.some((g) => g.source === "Intake Section 1");

  // One state update per event, computed from this render's goals.
  function change(index: number, patch: Partial<PlanGoal>, save = false) {
    const next = goals.map((g, i) => (i === index ? { ...g, ...patch } : g));
    setGoals(next);
    if (save) onSave(next);
  }

  function update(next: PlanGoal[]) {
    setGoals(next);
    onSave(next);
  }

  return (
    <div className="flex flex-col gap-3">
      {fromIntake && !disabled && (
        <p className="text-[12px] text-ink-500">
          Intake Section 1 records the client’s goal: “{intakeGoal}”{" "}
          <button
            type="button"
            className={`${BTN_GHOST} ${BTN_SM}`}
            onClick={() => update([...goals, { ...BLANK, goal: intakeGoal, source: "Intake Section 1" }])}
          >
            Add it as a goal
          </button>
        </p>
      )}
      {goals.length === 0 && <p className="text-[13px] text-ink-500">No goals recorded yet.</p>}
      {goals.map((g, index) => (
        <fieldset
          key={index}
          disabled={disabled}
          className="grid grid-cols-1 gap-2 rounded-lg border border-surface-border p-2.5 sm:grid-cols-2 lg:grid-cols-[2fr_1fr_1fr_1fr_1fr_auto]"
        >
          <label className="flex flex-col gap-1">
            <span className={FIELD_LABEL}>Goal (client’s words)</span>
            <input className={INPUT} value={g.goal} onChange={(e) => change(index, { goal: e.target.value })} onBlur={() => onSave(goals)} />
            {g.source && <span className="text-[11px] text-ink-500">From {g.source}</span>}
          </label>
          <label className="flex flex-col gap-1">
            <span className={FIELD_LABEL}>Linked action</span>
            <select className={INPUT} value={g.action_key} onChange={(e) => change(index, { action_key: e.target.value }, true)}>
              <option value="">— none —</option>
              {live.map((a) => (
                <option key={a.key} value={a.key}>{a.name}</option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1">
            <span className={FIELD_LABEL}>Formulation (5P)</span>
            <SelectChoices
              options={vs.options("formulation-5p")}
              value={g.formulation}
              placeholder="— none —"
              onChange={(code) => change(index, { formulation: code }, true)}
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className={FIELD_LABEL}>Owner</span>
            <input className={INPUT} value={g.owner} onChange={(e) => change(index, { owner: e.target.value })} onBlur={() => onSave(goals)} />
          </label>
          <label className="flex flex-col gap-1">
            <span className={FIELD_LABEL}>Review date</span>
            <input type="date" className={INPUT} value={g.review_date} onChange={(e) => change(index, { review_date: e.target.value }, true)} />
          </label>
          <div className="flex items-end">
            <button type="button" className={`${BTN_GHOST} ${BTN_SM}`} onClick={() => update(goals.filter((_, i) => i !== index))}>
              Remove
            </button>
          </div>
        </fieldset>
      ))}
      {!disabled && (
        <div>
          <button type="button" className={`${BTN_GHOST} ${BTN_SM}`} onClick={() => setGoals((current) => [...current, { ...BLANK }])}>
            Add goal
          </button>
        </div>
      )}
    </div>
  );
}

/** Where the client disagrees — structured points, each in the client's words. */
export function DisagreementsEditor({
  ws,
  disabled,
  onSave,
}: {
  ws: PlanWorkspace;
  disabled: boolean;
  onSave: (rows: PlanWorkspace["details"]["disagreements"]) => void;
}) {
  const vs = useValueSets();
  const [rows, setRows] = useState(ws.details.disagreements);

  function change(index: number, patch: Partial<(typeof rows)[number]>, save = false) {
    const next = rows.map((r, i) => (i === index ? { ...r, ...patch } : r));
    setRows(next);
    if (save) onSave(next);
  }

  return (
    <div className="flex flex-col gap-2">
      {rows.map((r, index) => (
        <fieldset key={index} disabled={disabled} className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_2fr_auto]">
          <label className="flex flex-col gap-1">
            <span className={FIELD_LABEL}>Part of the plan</span>
            <SelectChoices
              options={vs.options("care-plan-disagreement-part")}
              value={r.part}
              placeholder="— choose —"
              onChange={(code) => change(index, { part: code }, true)}
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className={FIELD_LABEL}>Client’s words</span>
            <input className={INPUT} value={r.words} onChange={(e) => change(index, { words: e.target.value })} onBlur={() => onSave(rows)} />
          </label>
          <div className="flex items-end">
            <button
              type="button"
              className={`${BTN_GHOST} ${BTN_SM}`}
              onClick={() => {
                const next = rows.filter((_, i) => i !== index);
                setRows(next);
                onSave(next);
              }}
            >
              Remove
            </button>
          </div>
        </fieldset>
      ))}
      {!disabled && (
        <div>
          <button type="button" className={`${BTN_GHOST} ${BTN_SM}`} onClick={() => setRows((current) => [...current, { part: "", words: "" }])}>
            Add a point of disagreement
          </button>
        </div>
      )}
    </div>
  );
}
