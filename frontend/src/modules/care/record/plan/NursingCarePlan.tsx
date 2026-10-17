import { useState } from "react";
import type { PlanWorkspace } from "../../../../lib/carePathwayApi";
import {
  addNursingProblem,
  evaluateNursingProblem,
  listNursingProblems,
  type NursingProblem,
} from "../../../../lib/carePlanOutcomesApi";
import { formatDateTime } from "../../shared/format";
import { BTN, BTN_GHOST, BTN_SM, FIELD_LABEL, INPUT, TABLE, TD, TH } from "../../shared/styles";
import { Card, ErrorNote } from "../../shared/ui";
import { errorText } from "../../triage/helpers";
import { useAuth } from "../../../../auth/useAuth";
import { useRecordData } from "../useRecordData";

const BLANK = { problem: "", goal: "", interventions: "", evaluation: "", action_key: "" };

/** Nursing care plan: problem → goal → interventions → evaluation, each linked
 * to the MDT plan action it serves. Evaluations are appended, never replaced. */
export function NursingCarePlan({ patientId, ws }: { patientId: string; ws: PlanWorkspace }) {
  const { accessToken } = useAuth();
  const [version, setVersion] = useState(0);
  const { data, error: loadError } = useRecordData(
    patientId,
    version,
    (token) => listNursingProblems(token, patientId),
    "Couldn't load the nursing care plan.",
  );
  const [draft, setDraft] = useState(BLANK);
  const [evaluating, setEvaluating] = useState<{ id: string; text: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const live = ws.actions.filter((a) => a.decision && a.decision !== "DECLINED");
  const rows: NursingProblem[] = data?.results ?? [];

  async function add() {
    if (!accessToken) return;
    if (!draft.problem.trim() || !draft.goal.trim()) {
      setError("Problem and goal are required.");
      return;
    }
    setError(null);
    try {
      await addNursingProblem(accessToken, patientId, draft);
      setDraft(BLANK);
      setVersion((v) => v + 1);
    } catch (e) {
      setError(errorText(e, "Couldn't save the nursing problem."));
    }
  }

  async function evaluate() {
    if (!accessToken || !evaluating) return;
    setError(null);
    try {
      await evaluateNursingProblem(accessToken, evaluating.id, evaluating.text);
      setEvaluating(null);
      setVersion((v) => v + 1);
    } catch (e) {
      setError(errorText(e, "Couldn't save the evaluation."));
    }
  }

  return (
    <Card title="Nursing care plan" aside={<span className="text-[11px] text-ink-500">problem → goal → interventions → evaluation</span>} className="mt-4">
      <ErrorNote>{error ?? loadError}</ErrorNote>
      {rows.length > 0 && (
        <div className="overflow-x-auto">
          <table className={`${TABLE} min-w-[720px]`}>
            <thead>
              <tr>
                <th className={TH}>Problem</th>
                <th className={TH}>Goal</th>
                <th className={TH}>Interventions</th>
                <th className={TH}>Evaluation</th>
                <th className={TH}>By</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((n) => (
                <tr key={n.id}>
                  <td className={TD}>
                    {n.problem}
                    {n.action_name && <div className="text-[11px] text-ink-500">↳ {n.action_name}</div>}
                  </td>
                  <td className={TD}>{n.goal}</td>
                  <td className={`${TD} whitespace-pre-line`}>{n.interventions || "—"}</td>
                  <td className={TD}>
                    {n.evaluations.length === 0 && "—"}
                    {n.evaluations.map((e) => (
                      <div key={e.at} className="mb-1">
                        {e.text}
                        <div className="text-[11px] text-ink-500">{e.by} · {formatDateTime(e.at)}</div>
                      </div>
                    ))}
                    {evaluating?.id === n.id ? (
                      <div className="mt-1 flex flex-col gap-1">
                        <textarea rows={2} aria-label="Evaluation" className={`${INPUT} resize-y`} value={evaluating.text} onChange={(e) => setEvaluating({ id: n.id, text: e.target.value })} />
                        <div className="flex gap-1.5">
                          <button type="button" className={`${BTN} ${BTN_SM}`} disabled={!evaluating.text.trim()} onClick={() => void evaluate()}>Save</button>
                          <button type="button" className={`${BTN_GHOST} ${BTN_SM}`} onClick={() => setEvaluating(null)}>Cancel</button>
                        </div>
                      </div>
                    ) : (
                      <button type="button" className={`${BTN_GHOST} ${BTN_SM} mt-1`} onClick={() => setEvaluating({ id: n.id, text: "" })}>
                        Add evaluation
                      </button>
                    )}
                  </td>
                  <td className={TD}>
                    {n.recorded_by}
                    <div className="text-[11px] text-ink-500">{formatDateTime(n.recorded_at)}</div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <details className="mt-3">
        <summary className="cursor-pointer text-[13px] font-semibold text-ink-900">+ Add a nursing problem</summary>
        <div className="mt-2 grid grid-cols-1 gap-3 sm:grid-cols-2">
          <label className="flex flex-col gap-1">
            <span className={FIELD_LABEL}>Problem</span>
            <input className={INPUT} value={draft.problem} onChange={(e) => setDraft((d) => ({ ...d, problem: e.target.value }))} />
          </label>
          <label className="flex flex-col gap-1">
            <span className={FIELD_LABEL}>Goal</span>
            <input className={INPUT} value={draft.goal} onChange={(e) => setDraft((d) => ({ ...d, goal: e.target.value }))} />
          </label>
          <label className="flex flex-col gap-1 sm:col-span-2">
            <span className={FIELD_LABEL}>Interventions</span>
            <textarea rows={2} className={`${INPUT} resize-y`} value={draft.interventions} onChange={(e) => setDraft((d) => ({ ...d, interventions: e.target.value }))} />
          </label>
          <label className="flex flex-col gap-1">
            <span className={FIELD_LABEL}>Evaluation (optional)</span>
            <input className={INPUT} value={draft.evaluation} onChange={(e) => setDraft((d) => ({ ...d, evaluation: e.target.value }))} />
          </label>
          <label className="flex flex-col gap-1">
            <span className={FIELD_LABEL}>Linked MDT action</span>
            <select className={INPUT} value={draft.action_key} onChange={(e) => setDraft((d) => ({ ...d, action_key: e.target.value }))}>
              <option value="">— none —</option>
              {live.map((a) => (
                <option key={a.key} value={a.key}>{a.name}</option>
              ))}
            </select>
          </label>
        </div>
        <button type="button" className={`${BTN} ${BTN_SM} mt-3`} onClick={() => void add()}>
          Save nursing problem
        </button>
      </details>
    </Card>
  );
}
