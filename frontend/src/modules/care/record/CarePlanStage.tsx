import { useId, useState } from "react";
import { Lightbulb } from "lucide-react";
import { useAuth } from "../../../auth/useAuth";
import { ApiError } from "../../../lib/apiClient";
import {
  addCarePlanActivity,
  getCarePlan,
  updateCarePlanActivity,
  type CarePlanActivity,
} from "../../../lib/carePathwayApi";
import { BTN, BTN_GHOST, BTN_SM, INPUT } from "../shared/styles";
import {
  Callout,
  Card,
  ErrorNote,
  Field,
  PageHeader,
  SelectChoices,
  Tag,
  Timeline,
} from "../shared/ui";
import { useValueSets } from "../shared/useValueSets";
import { orderedActivities } from "./activities";
import type { RecordViewProps } from "./types";
import { useRecordData } from "./useRecordData";

type Status = CarePlanActivity["status"];

/**
 * Care Plan — docs/15-CLINICAL-WORKSPACE-V3.md §1.17; mockup `careplan()`.
 * Documented actions with goals and status, suggested actions from the
 * client's active alerts, and the system recommendation.
 */
export function CarePlanStage({ patientId }: RecordViewProps) {
  const { accessToken } = useAuth();
  const vs = useValueSets();
  const formId = useId();
  const [version, setVersion] = useState(0);
  const {
    data: plan,
    error,
    loading,
  } = useRecordData(
    patientId,
    version,
    (token) => getCarePlan(token, patientId),
    "Couldn't load the care plan.",
  );
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [edits, setEdits] = useState<Map<string, Status>>(() => new Map());
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [draft, setDraft] = useState({ title: "", goal: "", module: "", status: "PLANNED" });

  const activities = orderedActivities(plan?.activities ?? []);
  const changed = activities.filter((a) => edits.has(a.id) && edits.get(a.id) !== a.status);

  const run = async (work: () => Promise<string>) => {
    setBusy(true);
    setActionError(null);
    setNote(null);
    try {
      setNote(await work());
      setVersion((v) => v + 1);
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : "Couldn't save the care plan.");
    } finally {
      setBusy(false);
    }
  };

  const savePlan = () => {
    if (!accessToken) return;
    if (changed.length === 0) {
      setNote("No changes to save.");
      return;
    }
    void run(async () => {
      for (const activity of changed) {
        await updateCarePlanActivity(accessToken, activity.id, { status: edits.get(activity.id) });
      }
      setEdits(new Map());
      return `Care plan saved — ${changed.length} ${changed.length === 1 ? "action" : "actions"} updated.`;
    });
  };

  const accept = (suggestion: { title: string; goal: string; module: string }) => {
    if (!accessToken) return;
    void run(async () => {
      await addCarePlanActivity(accessToken, patientId, { ...suggestion, status: "PLANNED" });
      return `Added “${suggestion.title}” to the care plan.`;
    });
  };

  const addAction = () => {
    if (!accessToken) return;
    const title = draft.title.trim();
    if (!title || !draft.module) {
      setActionError("Give the action a title and choose its module.");
      return;
    }
    void run(async () => {
      await addCarePlanActivity(accessToken, patientId, {
        title,
        goal: draft.goal.trim(),
        module: draft.module,
        status: draft.status as Status,
      });
      setDraft({ title: "", goal: "", module: "", status: "PLANNED" });
      return `Added “${title}” to the care plan.`;
    });
  };

  return (
    <div>
      <PageHeader
        title="Care Plan"
        subtitle="Converts clinical findings into trackable actions — the plan that drives interventions"
        actions={
          <>
            <button
              type="button"
              className={BTN_GHOST}
              aria-expanded={showSuggestions}
              onClick={() => setShowSuggestions((v) => !v)}
            >
              Suggested Actions
            </button>
            <button type="button" className={BTN} disabled={busy || !plan} onClick={savePlan}>
              {busy ? "Saving…" : "Save Plan"}
            </button>
          </>
        }
      />
      <div className="mb-3 flex flex-col gap-2">
        <ErrorNote>{error ?? actionError ?? vs.error}</ErrorNote>
        {note && (
          <Callout tone="success" role="status">
            {note}
          </Callout>
        )}
      </div>

      {showSuggestions && plan && (
        <Card title="Suggested Actions" className="mb-4">
          {plan.suggestions.length > 0 ? (
            <ul className="flex flex-col divide-y divide-surface-border">
              {plan.suggestions.map((s) => (
                <li
                  key={s.title}
                  className="flex flex-wrap items-center justify-between gap-2 py-2.5 first:pt-0 last:pb-0"
                >
                  <div className="min-w-0 text-[13px]">
                    <div className="font-semibold text-ink-900">{s.title}</div>
                    <div className="text-xs text-ink-500">
                      {s.goal} · {vs.label("care-module", s.module)}
                    </div>
                  </div>
                  <button
                    type="button"
                    className={`${BTN_GHOST} ${BTN_SM}`}
                    disabled={busy}
                    onClick={() => accept(s)}
                  >
                    Accept
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-[13px] text-ink-500">
              No suggested actions — every recommendation is already in the plan.
            </p>
          )}
        </Card>
      )}

      <Card title="Documented Care Plan Actions" className="mb-4">
        {loading && !plan ? (
          <p className="text-[13px] text-ink-500">Loading care plan…</p>
        ) : activities.length > 0 ? (
          <Timeline
            items={activities.map((a, index) => {
              const status = edits.get(a.id) ?? a.status;
              return {
                key: a.id,
                time: "",
                title: (
                  <>
                    {a.title} —{" "}
                    <Tag tone={a.status === "ACTIVE" ? "risk" : "neutral"}>
                      {vs.label("care-activity-status", a.status)}
                    </Tag>
                  </>
                ),
                detail: (
                  <div className="flex flex-col gap-1.5">
                    <span>
                      Goal {index + 1}: {a.goal || "No goal recorded"}
                      {a.module && ` · ${vs.label("care-module", a.module)}`}
                    </span>
                    <label className="flex max-w-xs items-center gap-2">
                      <span className="sr-only">Status for {a.title}</span>
                      <SelectChoices
                        options={vs.options("care-activity-status")}
                        value={status}
                        disabled={busy}
                        onChange={(code) =>
                          setEdits((prev) => new Map(prev).set(a.id, code as Status))
                        }
                      />
                      {status !== a.status && <Tag tone="warn">Unsaved</Tag>}
                    </label>
                  </div>
                ),
              };
            })}
          />
        ) : (
          <p className="text-[13px] text-ink-500">No care plan actions documented yet.</p>
        )}

        <form
          className="mt-5 border-t border-surface-border pt-4"
          aria-label="Add action"
          onSubmit={(e) => {
            e.preventDefault();
            addAction();
          }}
        >
          <div className="mb-2 text-[11px] font-bold uppercase tracking-wide text-ink-500">
            Add action
          </div>
          <div className="grid grid-cols-1 gap-x-4 gap-y-3 sm:grid-cols-2">
            <Field label="Action" htmlFor={`${formId}-title`}>
              <input
                id={`${formId}-title`}
                className={INPUT}
                value={draft.title}
                onChange={(e) => setDraft((d) => ({ ...d, title: e.target.value }))}
              />
            </Field>
            <Field label="Goal" htmlFor={`${formId}-goal`}>
              <input
                id={`${formId}-goal`}
                className={INPUT}
                value={draft.goal}
                onChange={(e) => setDraft((d) => ({ ...d, goal: e.target.value }))}
              />
            </Field>
            <Field label="Module" htmlFor={`${formId}-module`}>
              <SelectChoices
                id={`${formId}-module`}
                options={vs.options("care-module")}
                value={draft.module}
                placeholder="Select module"
                onChange={(module) => setDraft((d) => ({ ...d, module }))}
              />
            </Field>
            <Field label="Status" htmlFor={`${formId}-status`}>
              <SelectChoices
                id={`${formId}-status`}
                options={vs.options("care-activity-status")}
                value={draft.status}
                onChange={(status) => setDraft((d) => ({ ...d, status }))}
              />
            </Field>
          </div>
          <button type="submit" className={`${BTN_GHOST} mt-3`} disabled={busy}>
            Add action
          </button>
        </form>
      </Card>

      {plan?.recommendation && (
        <div className="flex gap-2.5 rounded-lg border border-l-[3px] border-surface-border border-l-brand-green bg-surface-bg px-3.5 py-3 text-[12.5px] text-ink-900">
          <Lightbulb className="mt-0.5 h-4 w-4 flex-shrink-0 text-brand-green" aria-hidden="true" />
          <div>
            <strong>System recommendation:</strong> {plan.recommendation}
          </div>
        </div>
      )}
    </div>
  );
}
