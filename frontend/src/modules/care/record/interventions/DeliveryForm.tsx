import { useId, useState } from "react";
import { useAuth } from "../../../../auth/useAuth";
import { ApiError } from "../../../../lib/apiClient";
import {
  recordIntervention,
  type InterventionAction,
  type InterventionModule,
} from "../../../../lib/carePathwayApi";
import { BTN, BTN_SM, INPUT } from "../../shared/styles";
import { Field } from "../../shared/ui";
import { billingNote } from "./rates";

/** "Record care delivered" (v4 `deliveryForm`): linked care-plan action,
 * optional sub-intervention chip, quantity in the module's unit, what was done,
 * and optional response / outcome / next action. Billing follows the module's
 * tariff line on the server — the form never picks a service. */
export function DeliveryForm({
  patientId,
  module,
  actions,
  onRecorded,
}: {
  patientId: string;
  module: InterventionModule;
  actions: InterventionAction[];
  onRecorded: (message: string) => void;
}) {
  const { accessToken } = useAuth();
  const id = useId();
  const only = module.linked_actions.length === 1 ? module.linked_actions[0] : "";
  const [form, setForm] = useState({
    activity: actions.some((a) => a.id === only) ? only : "",
    intervention: "",
    note: "",
    quantity: "1",
    response: "",
    outcome: "",
    nextAction: "",
    completes: false,
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = (changes: Partial<typeof form>) => setForm((f) => ({ ...f, ...changes }));
  const unit = module.unit ? `${module.unit}s` : "items";

  const submit = async () => {
    if (!accessToken) return;
    const quantity = Number(form.quantity);
    if (!Number.isInteger(quantity) || quantity < 1) {
      setError("Enter a quantity.");
      return;
    }
    if (!form.note.trim()) {
      setError("Add a brief note of what was done.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await recordIntervention(accessToken, patientId, {
        module: module.code,
        activity: form.activity || null,
        intervention: form.intervention,
        note: form.note.trim(),
        quantity,
        response: form.response.trim(),
        outcome: form.outcome.trim(),
        next_action: form.nextAction.trim(),
        completes_activity: Boolean(form.activity) && form.completes,
      });
      onRecorded(
        module.billable && module.rate !== null
          ? "Recorded — billing event created from the documented care."
          : "Recorded.",
      );
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't record this intervention.");
      setSaving(false);
    }
  };

  return (
    <form
      noValidate
      className="mt-3 rounded-[9px] border border-surface-border bg-surface-bg p-3"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <h5 className="mb-2 text-xs font-bold uppercase tracking-[.4px] text-ink-500">
        Record care delivered
      </h5>
      <div className="grid grid-cols-1 gap-x-5 gap-y-3 sm:grid-cols-2">
        <Field label="Linked care-plan action" htmlFor={`${id}-action`}>
          <select
            id={`${id}-action`}
            className={INPUT}
            value={form.activity}
            onChange={(e) => set({ activity: e.target.value, completes: false })}
          >
            <option value="">— not linked —</option>
            {actions.map((action) => (
              <option key={action.id} value={action.id}>
                Action: {action.title}
              </option>
            ))}
          </select>
        </Field>
        {module.options.length > 0 && (
          <div className="flex flex-col gap-1 sm:col-span-2">
            <span id={`${id}-chips`} className="text-[11px] font-semibold uppercase tracking-wide text-ink-500">
              Intervention
            </span>
            <div role="group" aria-labelledby={`${id}-chips`} className="mt-1.5 flex flex-wrap gap-1.5">
              {module.options.map((option) => {
                const pressed = form.intervention === option;
                return (
                  <button
                    key={option}
                    type="button"
                    aria-pressed={pressed}
                    onClick={() => set({ intervention: pressed ? "" : option })}
                    className={`min-h-[30px] rounded-full border px-2.5 py-[5px] text-xs transition-colors ${
                      pressed
                        ? "border-brand-green bg-brand-green-tint font-semibold text-brand-green"
                        : "border-surface-border bg-surface-card text-ink-900 hover:border-brand-green"
                    }`}
                  >
                    {option}
                  </button>
                );
              })}
            </div>
          </div>
        )}
        <Field label={`Quantity (${unit})`} htmlFor={`${id}-quantity`}>
          <input
            id={`${id}-quantity`}
            type="number"
            min={1}
            step={1}
            required
            className={INPUT}
            value={form.quantity}
            onChange={(e) => set({ quantity: e.target.value })}
          />
        </Field>
        <Field label="What was done" htmlFor={`${id}-note`}>
          <input
            id={`${id}-note`}
            required
            placeholder="Brief clinical note"
            className={INPUT}
            value={form.note}
            onChange={(e) => set({ note: e.target.value })}
          />
        </Field>
      </div>
      <details className="mb-1 mt-3 rounded-lg border border-dashed border-surface-border px-[11px] py-2">
        <summary className="flex min-h-[28px] cursor-pointer items-center text-xs font-semibold text-brand-green">
          Add response and next steps
        </summary>
        <div className="mt-2 grid grid-cols-1 gap-x-5 gap-y-3 sm:grid-cols-2">
          <Field label="Client response" htmlFor={`${id}-response`}>
            <input
              id={`${id}-response`}
              className={INPUT}
              value={form.response}
              onChange={(e) => set({ response: e.target.value })}
            />
          </Field>
          <Field label="Outcome / progress" htmlFor={`${id}-outcome`}>
            <input
              id={`${id}-outcome`}
              className={INPUT}
              value={form.outcome}
              onChange={(e) => set({ outcome: e.target.value })}
            />
          </Field>
          <Field label="Next action" htmlFor={`${id}-next`}>
            <input
              id={`${id}-next`}
              className={INPUT}
              value={form.nextAction}
              onChange={(e) => set({ nextAction: e.target.value })}
            />
          </Field>
          <label className="flex items-center gap-2 text-xs text-ink-700 sm:mt-6">
            <input
              type="checkbox"
              className="h-[17px] w-[17px] accent-[var(--green)]"
              checked={form.completes}
              disabled={!form.activity}
              onChange={(e) => set({ completes: e.target.checked })}
            />
            This completes the linked action
          </label>
        </div>
      </details>
      <p role="status" aria-live="polite" className="text-xs text-priority-red empty:hidden">
        {error}
      </p>
      <div className="sticky bottom-0 mt-2.5 flex items-center justify-between gap-2.5 border-t border-surface-border bg-surface-bg pb-0.5 pt-3">
        <span className="text-[11.5px] text-ink-500">{billingNote(module)}</span>
        <button type="submit" className={`${BTN} ${BTN_SM}`} disabled={saving}>
          {saving ? "Recording…" : "+ Record delivery"}
        </button>
      </div>
    </form>
  );
}
