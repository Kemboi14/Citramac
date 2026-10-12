import { useState } from "react";
import { useAuth } from "../../../../auth/useAuth";
import {
  decidePlanAction,
  type PlanPriority,
  type PlanWorkspace,
} from "../../../../lib/carePathwayApi";
import { errorText } from "../../triage/helpers";
import { BTN, BTN_GHOST, BTN_SM, FIELD_LABEL, INPUT } from "../../shared/styles";
import { Callout, ErrorNote, Tag } from "../../shared/ui";

const ORDER: PlanPriority[] = ["RED", "ORANGE", "YELLOW", "GREEN"];
const LABEL: Record<PlanPriority, string> = { RED: "Emergency", ORANGE: "Urgent", YELLOW: "Priority", GREEN: "Routine" };
const TONE: Record<PlanPriority, "risk" | "warn" | "neutral" | "brand"> = { RED: "risk", ORANGE: "warn", YELLOW: "neutral", GREEN: "brand" };

/** Accept, modify or decline each recommendation — each carries its provenance.
 * Lowering a recommended priority, or declining, needs a written reason. */
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
  const [open, setOpen] = useState<{ key: string; mode: "decline" | "modify" } | null>(null);
  const [reason, setReason] = useState("");
  const [instructions, setInstructions] = useState("");
  const [priority, setPriority] = useState<PlanPriority>("GREEN");

  async function decide(key: string, decision: "ACCEPTED" | "MODIFIED" | "ADDED" | "DECLINED", extra: { priority?: PlanPriority; reason?: string; instructions?: string } = {}) {
    if (!accessToken) return;
    setError(null);
    try {
      onChange(await decidePlanAction(accessToken, patientId, key, { decision, ...extra }));
      setOpen(null);
      setReason("");
      setInstructions("");
    } catch (e) {
      setError(errorText(e, "Couldn't save the decision."));
    }
  }

  const acted = (key: string) => ws.actions.find((a) => a.key === key);
  const recKeys = new Set(ws.recommendations.map((r) => r.key));
  const extras = ws.actions.filter((a) => !recKeys.has(a.key));

  return (
    <div className="flex flex-col gap-3">
      <Callout>
        <strong>Recommendations from the record — you decide.</strong> Suggested priority from findings:{" "}
        <Tag tone={TONE[ws.suggested_priority]}>{LABEL[ws.suggested_priority]}</Tag> (a suggestion only — it
        never changes the triage priority).
        {ws.rules_approval === "illustrative" && (
          <span className="ml-1 text-ink-500">Trigger rules are illustrative until a clinician approves them.</span>
        )}
      </Callout>
      <ErrorNote>{error}</ErrorNote>
      {ws.conflicts.map((c) => (
        <Callout key={c} tone="warning" role="alert">
          {c}
        </Callout>
      ))}
      <ul className="flex flex-col gap-2">
        {ORDER.flatMap((p) => ws.recommendations.filter((r) => r.priority === p)).map((rec) => {
          const act = acted(rec.key);
          return (
            <li key={rec.key} className="rounded-lg border border-surface-border p-3" data-action-key={rec.key}>
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-[13px] font-semibold text-ink-900">{rec.name}</span>
                <Tag tone={TONE[rec.priority]}>recommended · {LABEL[rec.priority]}</Tag>
                {act && (
                  <Tag tone={act.decision === "DECLINED" ? "risk" : act.decision === "MODIFIED" ? "warn" : "brand"}>
                    {act.decision === "DECLINED" ? "Declined" : act.decision === "MODIFIED" ? "Modified" : "Accepted"}
                    {act.priority ? ` · ${LABEL[act.priority]}` : ""}
                  </Tag>
                )}
              </div>
              <ul className="mt-1 text-[12px] text-ink-500">
                {rec.why.map((w) => (
                  <li key={w}>{w}</li>
                ))}
              </ul>
              {act?.decision === "DECLINED" && <p className="mt-1 text-[12px] text-priority-red">Declined — “{act.reason}”</p>}
              {act && act.decision !== "DECLINED" && act.instructions && (
                <p className="mt-1 text-[12px] text-ink-900">Instructions: {act.instructions}</p>
              )}
              {!disabled && (
                <div className="mt-2 flex flex-wrap gap-2">
                  {(!act || act.decision === "DECLINED") && (
                    <button type="button" className={`${BTN} ${BTN_SM}`} onClick={() => void decide(rec.key, "ACCEPTED")}>
                      Accept
                    </button>
                  )}
                  <button
                    type="button"
                    className={`${BTN_GHOST} ${BTN_SM}`}
                    onClick={() => {
                      setOpen({ key: rec.key, mode: "modify" });
                      setPriority(act?.priority || rec.priority);
                      setInstructions(act?.instructions ?? "");
                    }}
                  >
                    {act && act.decision !== "DECLINED" ? "Change priority / instructions" : "Accept with changes…"}
                  </button>
                  {!act && (
                    <button type="button" className={`${BTN_GHOST} ${BTN_SM}`} onClick={() => setOpen({ key: rec.key, mode: "decline" })}>
                      Decline…
                    </button>
                  )}
                </div>
              )}
              {open?.key === rec.key && (
                <div className="mt-2 flex flex-col gap-2 rounded-md bg-surface-bg p-2.5">
                  {open.mode === "modify" && (
                    <>
                      <div role="group" aria-label={`Priority for ${rec.name}`} className="flex flex-wrap gap-1.5">
                        {ORDER.map((p) => (
                          <button
                            key={p}
                            type="button"
                            aria-pressed={priority === p}
                            className={`rounded-md border px-2 py-1 text-[11px] font-semibold ${priority === p ? "border-brand-green bg-brand-green-tint" : "border-surface-border"}`}
                            onClick={() => setPriority(p)}
                          >
                            {LABEL[p]}
                          </button>
                        ))}
                      </div>
                      <input className={INPUT} aria-label="Instructions" placeholder="Instructions (e.g. review within the hour; family present)" value={instructions} onChange={(e) => setInstructions(e.target.value)} />
                    </>
                  )}
                  {(open.mode === "decline" || ORDER.indexOf(priority) > ORDER.indexOf(rec.priority)) && (
                    <label className="flex flex-col gap-1">
                      <span className={FIELD_LABEL}>
                        {open.mode === "decline"
                          ? "Reason for declining (required)"
                          : `Reason for setting the priority below the recommendation (${LABEL[rec.priority]})`}
                      </span>
                      <input className={INPUT} value={reason} onChange={(e) => setReason(e.target.value)} />
                    </label>
                  )}
                  <div className="flex gap-2">
                    <button
                      type="button"
                      className={`${open.mode === "decline" ? BTN_GHOST : BTN} ${BTN_SM}`}
                      onClick={() =>
                        void (open.mode === "decline"
                          ? decide(rec.key, "DECLINED", { reason })
                          : decide(rec.key, priority === rec.priority ? "ACCEPTED" : "MODIFIED", { priority, instructions, reason }))
                      }
                    >
                      {open.mode === "decline" ? "Confirm decline" : "Save"}
                    </button>
                    <button type="button" className={`${BTN_GHOST} ${BTN_SM}`} onClick={() => setOpen(null)}>
                      Cancel
                    </button>
                  </div>
                </div>
              )}
            </li>
          );
        })}
      </ul>
      {extras.length > 0 && (
        <div>
          <div className={FIELD_LABEL}>Added by clinician</div>
          <ul className="mt-1 flex flex-col gap-1 text-[13px]">
            {extras.map((a) => (
              <li key={a.id}>
                {a.name} {a.priority && <Tag tone={TONE[a.priority]}>{LABEL[a.priority]}</Tag>}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
