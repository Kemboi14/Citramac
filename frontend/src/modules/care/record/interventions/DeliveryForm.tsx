import { useId, useState } from "react";
import { useAuth } from "../../../../auth/useAuth";
import { ApiError } from "../../../../lib/apiClient";
import {
  recordIntervention,
  type InterventionAction,
  type InterventionModule,
} from "../../../../lib/carePathwayApi";
import { BTN, INPUT } from "../../shared/styles";
import { Field } from "../../shared/ui";
import { billingNote } from "./rates";

/** Record tab's delivery form (mockup `#intervention-form`): linked action,
 * intervention chip, what was done, quantity, optional response and next
 * steps. Billing follows the module's tariff line on the server. */
export function DeliveryForm({
  patientId,
  module,
  actions,
  onRecorded,
}: {
  patientId: string;
  module: InterventionModule;
  actions: InterventionAction[];
  onRecorded: () => void;
}) {
  const { accessToken } = useAuth();
  const id = useId();
  const linkable = actions.some((action) => action.id === module.action_id);
  const [form, setForm] = useState({
    activity: linkable && module.action_id ? module.action_id : "",
    intervention: module.options[0] ?? "",
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

  const submit = async () => {
    if (!accessToken) return;
    const quantity = Number(form.quantity);
    if (!form.note.trim() || !Number.isInteger(quantity) || quantity < 1) {
      setError("Enter a clinical note and a quantity of at least 1.");
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
      onRecorded();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't record this intervention.");
      setSaving(false);
    }
  };

  return (
    <form
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <p
        role="status"
        aria-live="polite"
        className={`mb-3.5 text-xs empty:hidden ${error ? "text-priority-red" : "text-ink-500"}`}
      >
        {error}
      </p>
      <Field label="Linked care-plan action" htmlFor={`${id}-action`} className="mt-3">
        <select
          id={`${id}-action`}
          className={INPUT}
          value={form.activity}
          onChange={(e) => set({ activity: e.target.value, completes: false })}
        >
          <option value="">Not linked to a care-plan action</option>
          {actions.map((action) => (
            <option key={action.id} value={action.id}>
              {action.title}
            </option>
          ))}
        </select>
      </Field>
      <div className="mt-3 flex flex-col gap-1">
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
                onClick={() => set({ intervention: option })}
                className={`min-h-[30px] rounded-full border px-2.5 py-[5px] text-[11px] transition-colors ${
                  pressed
                    ? "border-brand-green bg-brand-green-tint font-semibold text-brand-green"
                    : "border-surface-border bg-surface-card text-ink-900"
                }`}
              >
                {option}
              </button>
            );
          })}
        </div>
      </div>
      <div className="grid grid-cols-1 gap-x-3 sm:grid-cols-2">
        <Field label="What was done" htmlFor={`${id}-note`} className="mt-3">
          <textarea
            id={`${id}-note`}
            rows={2}
            required
            placeholder="Brief clinical note"
            className={`${INPUT} resize-y`}
            value={form.note}
            onChange={(e) => set({ note: e.target.value })}
          />
        </Field>
        <Field label="Quantity" htmlFor={`${id}-quantity`} className="mt-3">
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
      </div>
      <details className="mb-1 mt-3.5 rounded-lg border border-dashed border-surface-border px-3 py-2">
        <summary className="flex min-h-[28px] cursor-pointer items-center text-xs font-semibold text-brand-green">
          Add response and next steps
        </summary>
        <div className="grid grid-cols-1 gap-x-3 sm:grid-cols-2">
          <Field label="Client response" htmlFor={`${id}-response`} className="mt-3">
            <input
              id={`${id}-response`}
              className={INPUT}
              value={form.response}
              onChange={(e) => set({ response: e.target.value })}
            />
          </Field>
          <Field label="Outcome / progress" htmlFor={`${id}-outcome`} className="mt-3">
            <input
              id={`${id}-outcome`}
              className={INPUT}
              value={form.outcome}
              onChange={(e) => set({ outcome: e.target.value })}
            />
          </Field>
          <Field label="Next action" htmlFor={`${id}-next`} className="mt-3">
            <input
              id={`${id}-next`}
              className={INPUT}
              value={form.nextAction}
              onChange={(e) => set({ nextAction: e.target.value })}
            />
          </Field>
          <label className="mt-3 flex items-center gap-2 text-xs text-ink-500 sm:mt-7">
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
      <div className="sticky bottom-0 -mx-[clamp(18px,4vw,48px)] mt-4 flex items-center justify-between gap-3 border-t border-surface-border bg-surface-card px-[clamp(18px,4vw,48px)] py-3">
        <span className="text-[11px] text-ink-500">{billingNote(module)}</span>
        <button type="submit" className={BTN} disabled={saving}>
          {saving ? "Recording…" : "Record delivery"}
        </button>
      </div>
    </form>
  );
}
