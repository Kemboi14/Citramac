import { useId, useRef, useState } from "react";
import { useAuth } from "../../../auth/useAuth";
import { ApiError } from "../../../lib/apiClient";
import {
  getCarePlan,
  listBillingServices,
  listInterventions,
  recordIntervention,
} from "../../../lib/carePathwayApi";
import { formatDateTime } from "../shared/format";
import { BTN, BTN_GHOST, INPUT, TABLE, TD, TH } from "../shared/styles";
import { Callout, Card, ErrorNote, Field, PageHeader, Tag } from "../shared/ui";
import { useValueSets } from "../shared/useValueSets";
import { orderedActivities } from "./activities";
import type { RecordViewProps } from "./types";
import { useRecordData } from "./useRecordData";

const pad = (n: number) => String(n).padStart(2, "0");
function localNow() {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

const EMPTY_FORM = {
  activity: "",
  performedAt: "",
  intervention: "",
  response: "",
  nextAction: "",
  billable: false,
  billingService: "",
  quantity: "1",
};

/**
 * Intervention Engine — docs/15-CLINICAL-WORKSPACE-V3.md §1.17; mockup
 * `interventions()`. Care Plan → Intervention → Module → Outcome. A billable
 * intervention with a service creates its charge server-side.
 */
export function InterventionsStage({ patientId }: RecordViewProps) {
  const { accessToken } = useAuth();
  const vs = useValueSets();
  const id = useId();
  const recordRef = useRef<HTMLDivElement>(null);
  const [version, setVersion] = useState(0);
  const plan = useRecordData(
    patientId,
    version,
    (token) => getCarePlan(token, patientId),
    "Couldn't load the care plan.",
  );
  const records = useRecordData(
    patientId,
    version,
    (token) => listInterventions(token, patientId),
    "Couldn't load the intervention record.",
  );
  const services = useRecordData(
    "billing-services",
    0,
    (token) => listBillingServices(token),
    "Couldn't load the billable services.",
  );
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const activities = orderedActivities(plan.data?.activities ?? []);
  const goalNumber = new Map(activities.map((a, index) => [a.id, index + 1]));
  const rows = [...(records.data?.results ?? [])].sort((a, b) =>
    b.performed_at.localeCompare(a.performed_at),
  );
  const activeServices = (services.data ?? []).filter((s) => s.active);

  const openForm = () => {
    setForm({ ...EMPTY_FORM, performedAt: localNow() });
    setFormError(null);
    setNote(null);
    setShowForm(true);
  };

  const submit = async () => {
    if (!accessToken) return;
    const quantity = Number(form.quantity);
    if (!form.activity || !form.intervention.trim()) {
      setFormError("Choose the care plan action and describe the intervention.");
      return;
    }
    if (form.billable && (!form.billingService || !Number.isInteger(quantity) || quantity < 1)) {
      setFormError("A billable intervention needs a billed service and a quantity of at least 1.");
      return;
    }
    setSaving(true);
    setFormError(null);
    try {
      await recordIntervention(accessToken, patientId, {
        activity: form.activity,
        intervention: form.intervention.trim(),
        response: form.response.trim(),
        next_action: form.nextAction.trim(),
        performed_at: form.performedAt ? new Date(form.performedAt).toISOString() : undefined,
        billable: form.billable,
        billing_service: form.billable ? form.billingService : null,
        quantity: form.billable ? quantity : 1,
      });
      setShowForm(false);
      setNote("Intervention recorded.");
      setVersion((v) => v + 1);
    } catch (err) {
      setFormError(err instanceof ApiError ? err.message : "Couldn't record the intervention.");
    } finally {
      setSaving(false);
    }
  };

  const set = (changes: Partial<typeof EMPTY_FORM>) => setForm((f) => ({ ...f, ...changes }));

  return (
    <div>
      <PageHeader
        title="Intervention Engine"
        subtitle="Care Plan → Intervention → Module → Outcome"
        actions={
          <>
            <button
              type="button"
              className={BTN_GHOST}
              onClick={() =>
                recordRef.current?.scrollIntoView({ behavior: "smooth", block: "start" })
              }
            >
              Intervention Record
            </button>
            <button type="button" className={BTN} onClick={openForm}>
              + New Intervention
            </button>
          </>
        }
      />
      <div className="mb-3 flex flex-col gap-2">
        <ErrorNote>{plan.error ?? records.error ?? vs.error}</ErrorNote>
        {note && (
          <Callout tone="success" role="status">
            {note}
          </Callout>
        )}
      </div>

      {showForm && (
        <Card title="New Intervention" className="mb-4">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void submit();
            }}
          >
            {activities.length === 0 ? (
              <Callout role="status">
                Document a care plan action first — every intervention is recorded against one.
              </Callout>
            ) : (
              <div className="grid grid-cols-1 gap-x-4 gap-y-3 sm:grid-cols-2">
                <Field label="Care plan action" htmlFor={`${id}-activity`}>
                  <select
                    id={`${id}-activity`}
                    className={INPUT}
                    required
                    value={form.activity}
                    onChange={(e) => set({ activity: e.target.value })}
                  >
                    <option value="">Select care plan action</option>
                    {activities.map((a, index) => (
                      <option key={a.id} value={a.id}>
                        Goal {index + 1}: {a.title}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Date / Time" htmlFor={`${id}-at`}>
                  <input
                    id={`${id}-at`}
                    type="datetime-local"
                    className={INPUT}
                    value={form.performedAt}
                    max={localNow()}
                    onChange={(e) => set({ performedAt: e.target.value })}
                  />
                </Field>
                <Field
                  label="Intervention"
                  htmlFor={`${id}-intervention`}
                  className="sm:col-span-2"
                >
                  <input
                    id={`${id}-intervention`}
                    className={INPUT}
                    required
                    value={form.intervention}
                    onChange={(e) => set({ intervention: e.target.value })}
                  />
                </Field>
                <Field label="Response / Outcome" htmlFor={`${id}-response`}>
                  <textarea
                    id={`${id}-response`}
                    rows={2}
                    className={INPUT}
                    value={form.response}
                    onChange={(e) => set({ response: e.target.value })}
                  />
                </Field>
                <Field label="Next Action" htmlFor={`${id}-next`}>
                  <textarea
                    id={`${id}-next`}
                    rows={2}
                    className={INPUT}
                    value={form.nextAction}
                    onChange={(e) => set({ nextAction: e.target.value })}
                  />
                </Field>
                <label className="flex items-center gap-2 text-[13px] text-ink-900 sm:col-span-2">
                  <input
                    type="checkbox"
                    className="h-[17px] w-[17px] accent-[var(--green)]"
                    checked={form.billable}
                    onChange={(e) => set({ billable: e.target.checked })}
                  />
                  Billable
                </label>
                {form.billable && (
                  <>
                    <Field label="Billed service" htmlFor={`${id}-service`}>
                      <select
                        id={`${id}-service`}
                        className={INPUT}
                        required
                        value={form.billingService}
                        onChange={(e) => set({ billingService: e.target.value })}
                      >
                        <option value="">Select service</option>
                        {activeServices.map((s) => (
                          <option key={s.id} value={s.id}>
                            {s.name}
                            {s.rate === null ? " (rate not configured)" : ""}
                          </option>
                        ))}
                      </select>
                      <ErrorNote>{services.error}</ErrorNote>
                    </Field>
                    <Field label="Quantity" htmlFor={`${id}-quantity`}>
                      <input
                        id={`${id}-quantity`}
                        type="number"
                        min={1}
                        step={1}
                        className={INPUT}
                        value={form.quantity}
                        onChange={(e) => set({ quantity: e.target.value })}
                      />
                    </Field>
                  </>
                )}
              </div>
            )}
            <div className="mt-3 flex flex-col gap-2">
              <ErrorNote>{formError}</ErrorNote>
              <div className="flex flex-wrap gap-2">
                <button type="submit" className={BTN} disabled={saving || activities.length === 0}>
                  {saving ? "Recording…" : "Record Intervention"}
                </button>
                <button type="button" className={BTN_GHOST} onClick={() => setShowForm(false)}>
                  Cancel
                </button>
              </div>
            </div>
          </form>
        </Card>
      )}

      <Card title="Care Plan Action → Module Recommendation" className="mb-4" bodyClassName="p-0">
        <div className="overflow-x-auto">
          <table className={`${TABLE} min-w-[480px]`}>
            <thead>
              <tr>
                <th className={TH}>Care Plan Action</th>
                <th className={TH}>Module</th>
                <th className={TH}>Status</th>
              </tr>
            </thead>
            <tbody>
              {activities.length > 0 ? (
                activities.map((a) => (
                  <tr key={a.id}>
                    <td className={TD}>
                      <strong>{a.title}</strong>
                    </td>
                    <td className={TD}>{a.module ? vs.label("care-module", a.module) : "—"}</td>
                    <td className={TD}>
                      <Tag>{vs.label("care-activity-status", a.status)}</Tag>
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={3} className={`${TD} py-6 text-center text-ink-500`}>
                    {plan.loading && !plan.data
                      ? "Loading care plan…"
                      : "No care plan actions documented yet."}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>

      <div ref={recordRef} className="scroll-mt-32">
        <Card title="Intervention Record" className="mb-4" bodyClassName="p-0">
          <div className="overflow-x-auto">
            <table className={`${TABLE} min-w-[820px]`}>
              <thead>
                <tr>
                  <th className={TH}>Care Plan Goal</th>
                  <th className={TH}>Date / Time</th>
                  <th className={TH}>Provider</th>
                  <th className={TH}>Intervention</th>
                  <th className={TH}>Response / Outcome</th>
                  <th className={TH}>Next Action</th>
                </tr>
              </thead>
              <tbody>
                {rows.length > 0 ? (
                  rows.map((r) => {
                    const goal = goalNumber.get(r.activity);
                    return (
                      <tr key={r.id}>
                        <td className={TD} title={r.activity_goal || undefined}>
                          {goal ? `Goal ${goal}` : "Goal"}
                          <div className="text-[11px] text-ink-500">{r.activity_title}</div>
                        </td>
                        <td className={`${TD} whitespace-nowrap font-mono text-xs`}>
                          {formatDateTime(r.performed_at)}
                        </td>
                        <td className={TD}>{r.provider_name || "—"}</td>
                        <td className={TD}>
                          {r.intervention}
                          {r.billable && (
                            <div className="mt-1">
                              <Tag tone="brand">
                                Billable
                                {r.billing_service_name ? ` · ${r.billing_service_name}` : ""}
                                {r.quantity > 1 ? ` × ${r.quantity}` : ""}
                              </Tag>
                            </div>
                          )}
                        </td>
                        <td className={TD}>{r.response || "—"}</td>
                        <td className={TD}>{r.next_action || "—"}</td>
                      </tr>
                    );
                  })
                ) : (
                  <tr>
                    <td colSpan={6} className={`${TD} py-6 text-center text-ink-500`}>
                      {records.loading && !records.data
                        ? "Loading intervention record…"
                        : "No interventions recorded for this client yet."}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </Card>
      </div>

      <Callout>
        <strong>Billing link:</strong> A completed intervention marked billable automatically
        creates the relevant billing event — care is documented once and billed from the record.
      </Callout>
    </div>
  );
}
