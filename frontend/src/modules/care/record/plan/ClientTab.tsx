import { useEffect, useState } from "react";
import { useAuth } from "../../../../auth/useAuth";
import {
  giveSafetyPlanCopy,
  listSeniors,
  openSafetyPlan,
  saveSafetyPlan,
  signSafetyPlan,
  updatePlanDetails,
  type PlanWorkspace,
  type SafetyPlanDoc,
} from "../../../../lib/carePathwayApi";
import { acknowledgePlan } from "../../../../lib/carePlanOutcomesApi";
import { errorText } from "../../triage/helpers";
import { formatDateTime } from "../../shared/format";
import { BTN, BTN_GHOST, FIELD_LABEL, INPUT } from "../../shared/styles";
import { Callout, Card, ErrorNote, SelectChoices, Tag } from "../../shared/ui";
import { useValueSets } from "../../shared/useValueSets";
import { CoProductionView } from "./CoProductionView";
import { DisagreementsEditor, GoalsEditor } from "./GoalsEditor";
import { SAFETY_KEYS, SAFETY_LABELS } from "./safetyLabels";

const FAMILY_CONSENT: Record<PlanWorkspace["family_consent"], string> = {
  NOT_ASKED: "not yet asked",
  YES: "client agrees",
  NO: "client declined — do not involve family",
  RESTRICTED: "restricted to the treating facility",
};

/** With the client: agreement and where they disagree, what matters, goals,
 * crisis and family plans, the written client-held safety plan, opioid safety
 * and the follow-up contact that makes it safe to go home. */
export function ClientTab({
  patientId,
  clientName,
  ws,
  onChange,
  disabled,
}: {
  patientId: string;
  clientName: string;
  ws: PlanWorkspace;
  onChange: (next: PlanWorkspace) => void;
  disabled: boolean;
}) {
  const { accessToken } = useAuth();
  const vs = useValueSets();
  const [error, setError] = useState<string | null>(null);
  const [seniors, setSeniors] = useState<{ id: string; name: string }[]>([]);
  const [details, setDetails] = useState(ws.details);
  const [plan, setPlan] = useState<SafetyPlanDoc | null>(null);
  const [showClient, setShowClient] = useState(false);
  // Re-mounts the list editors when the server changes their rows (e.g. the client disagrees).
  const [editorKey, setEditorKey] = useState(0);

  useEffect(() => {
    if (!accessToken) return;
    void listSeniors(accessToken).then((r) => setSeniors(r.results)).catch(() => undefined);
    if (ws.needs_safety_plan) {
      openSafetyPlan(accessToken, patientId).then(setPlan).catch((e) => setError(errorText(e, "Couldn't open the safety plan.")));
    }
  }, [accessToken, patientId, ws.needs_safety_plan]);

  async function saveDetails(patch: Partial<typeof details>) {
    if (!accessToken) return;
    setDetails((d) => ({ ...d, ...patch }));
    try {
      onChange(await updatePlanDetails(accessToken, patientId, patch));
    } catch (e) {
      setError(errorText(e, "Couldn't save."));
    }
  }

  async function savePlan(patch: Partial<SafetyPlanDoc>) {
    if (!accessToken || !plan) return;
    setPlan({ ...plan, ...patch });
    try {
      setPlan(await saveSafetyPlan(accessToken, patientId, patch));
    } catch (e) {
      setError(errorText(e, "Couldn't save the safety plan."));
    }
  }

  async function signPlan() {
    if (!accessToken) return;
    try {
      setPlan(await signSafetyPlan(accessToken, patientId));
      onChange(await updatePlanDetails(accessToken, patientId, {}));
    } catch (e) {
      setError(errorText(e, "Couldn't sign the safety plan."));
    }
  }

  async function acknowledge(language: "en" | "sw") {
    if (!accessToken) return;
    try {
      const next = await acknowledgePlan(accessToken, patientId, language);
      setDetails(next.details);
      onChange(next);
      setShowClient(false);
    } catch (e) {
      setError(errorText(e, "Couldn't record the acknowledgement."));
    }
  }

  async function clientDisagrees() {
    setShowClient(false);
    await saveDetails({ client_agreement: "PARTIAL", disagreements: [...details.disagreements, { part: "", words: "" }] });
    setEditorKey((k) => k + 1);
  }

  const labels = SAFETY_LABELS[plan?.language ?? "en"];
  const locked = Boolean(plan?.signed_at);
  const intakeMatters = ws.intake.what_matters.trim();
  return (
    <div className="flex flex-col gap-4">
      <ErrorNote>{error}</ErrorNote>
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" className={BTN_GHOST} onClick={() => setShowClient(true)}>
          Show the plan to the client (large text, their language)
        </button>
        {ws.client_ack && (
          <Tag tone="brand">
            Client acknowledged {formatDateTime(ws.client_ack.at)} ({ws.client_ack.language === "sw" ? "Kiswahili" : "English"})
          </Tag>
        )}
      </div>
      <CoProductionView
        open={showClient}
        clientName={clientName}
        ws={ws}
        safetyPlan={plan}
        onClose={() => setShowClient(false)}
        onAcknowledge={(language) => void acknowledge(language)}
        onDisagree={() => void clientDisagrees()}
      />
      <Card title="Agreement and what matters">
        <fieldset disabled={disabled} className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <label className="flex flex-col gap-1">
            <span className={FIELD_LABEL}>Client agreement <span className="text-priority-red">*</span></span>
            <SelectChoices
              options={vs.options("care-plan-agreement")}
              value={details.client_agreement}
              placeholder="— select —"
              onChange={(code) => void saveDetails({ client_agreement: code })}
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className={FIELD_LABEL}>What matters to me (client’s own words)</span>
            <input
              key={`matters-${editorKey}`}
              className={INPUT}
              defaultValue={details.what_matters}
              onBlur={(e) => e.target.value !== details.what_matters && void saveDetails({ what_matters: e.target.value })}
            />
            {intakeMatters && intakeMatters !== details.what_matters && !disabled && (
              <span className="text-[11px] text-ink-500">
                Intake Section 18: “{intakeMatters}”{" "}
                <button
                  type="button"
                  className="font-semibold text-brand-green hover:underline"
                  onClick={() => {
                    void saveDetails({ what_matters: intakeMatters });
                    setEditorKey((k) => k + 1);
                  }}
                >
                  Use this
                </button>
              </span>
            )}
          </label>
          <label className="flex flex-col gap-1 sm:col-span-2">
            <span className={FIELD_LABEL}>Rationale — required when the plan conflicts with the client’s priority</span>
            <textarea rows={2} className={`${INPUT} resize-y`} defaultValue={details.rationale} onBlur={(e) => void saveDetails({ rationale: e.target.value })} />
          </label>
          <label className="flex flex-col gap-1">
            <span className={FIELD_LABEL}>Senior review (co-signs a conflicting plan)</span>
            <select className={INPUT} value={details.senior_reviewer} onChange={(e) => void saveDetails({ senior_reviewer: e.target.value })}>
              <option value="">— none —</option>
              {seniors.map((s) => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </select>
          </label>
        </fieldset>
      </Card>

      <Card title="Where the client disagrees" aside={<span className="text-[11px] text-ink-500">structured — in their words</span>}>
        <DisagreementsEditor
          key={`disagree-${editorKey}`}
          ws={ws}
          disabled={disabled}
          onSave={(rows) => void saveDetails({ disagreements: rows })}
        />
      </Card>

      <Card title="My goals">
        <GoalsEditor key={`goals-${editorKey}`} ws={ws} disabled={disabled} onSave={(goals) => void saveDetails({ goal_items: goals })} />
      </Card>

      <Card title="Crisis, family and advance wishes">
        <fieldset disabled={disabled} className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <label className="flex flex-col gap-1">
            <span className={FIELD_LABEL}>Crisis &amp; relapse plan</span>
            <textarea rows={3} className={`${INPUT} resize-y`} defaultValue={details.crisis_plan} onBlur={(e) => e.target.value !== details.crisis_plan && void saveDetails({ crisis_plan: e.target.value })} />
          </label>
          <label className="flex flex-col gap-1">
            <span className={FIELD_LABEL}>Family / carer involvement (consent: {FAMILY_CONSENT[ws.family_consent]})</span>
            <textarea rows={3} className={`${INPUT} resize-y`} defaultValue={details.family_involvement} onBlur={(e) => e.target.value !== details.family_involvement && void saveDetails({ family_involvement: e.target.value })} />
            {ws.family_consent === "NO" && (
              <span role="alert" className="text-[11px] font-semibold text-priority-red">
                The client declined family involvement — record only what the client has agreed to share.
              </span>
            )}
          </label>
          <label className="flex flex-col gap-1 sm:col-span-2">
            <span className={FIELD_LABEL}>Advance statement &amp; treatment preferences</span>
            <textarea rows={2} className={`${INPUT} resize-y`} defaultValue={details.advance_statement} onBlur={(e) => e.target.value !== details.advance_statement && void saveDetails({ advance_statement: e.target.value })} />
          </label>
        </fieldset>
      </Card>

      {ws.is_opioid && (
        <Card title="Opioid safety">
          <fieldset disabled={disabled} className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <label className="flex items-center gap-2 text-[13px] sm:col-span-2">
              <input type="checkbox" checked={details.naloxone_teaching} onChange={(e) => void saveDetails({ naloxone_teaching: e.target.checked })} />
              Naloxone kit and overdose-risk teaching at discharge (tolerance falls quickly)
            </label>
            <label className="flex flex-col gap-1">
              <span className={FIELD_LABEL}>Opioid agonist therapy</span>
              <SelectChoices
                options={vs.options("oat-offer")}
                value={details.oat_offer}
                placeholder="— not yet discussed —"
                onChange={(code) => void saveDetails({ oat_offer: code })}
              />
            </label>
          </fieldset>
        </Card>
      )}

      {ws.needs_safety_plan && (
        <Card title="Safety plan (client-held)" aside={plan && <Tag tone={plan.signed_at ? "brand" : "warn"}>{plan.signed_at ? `v${plan.version} signed` : `v${plan.version} draft`}</Tag>}>
          {!plan ? (
            <p className="text-[13px] text-ink-500">Loading…</p>
          ) : (
            <div className="flex flex-col gap-3">
              <Callout>
                Written with the client, in their own words. Give them a copy; a signed plan is never edited — a revision is a new version.
              </Callout>
              <label className="flex max-w-[200px] flex-col gap-1">
                <span className={FIELD_LABEL}>Language of the copy</span>
                <select className={INPUT} disabled={locked} value={plan.language} onChange={(e) => void savePlan({ language: e.target.value as "en" | "sw" })}>
                  <option value="en">English</option>
                  <option value="sw">Kiswahili</option>
                </select>
              </label>
              {plan.language === "sw" && (
                <Callout tone="warning">
                  Kiswahili labels are a draft — verify with a qualified translator before clinical use.
                </Callout>
              )}
              <h3 className="font-display text-sm font-semibold">{labels.title}</h3>
              {SAFETY_KEYS.map((k) => (
                <label key={k} className="flex flex-col gap-1">
                  <span className={FIELD_LABEL}>{labels[k]}</span>
                  <textarea
                    rows={2}
                    disabled={locked}
                    className={`${INPUT} resize-y`}
                    defaultValue={plan[k]}
                    key={`${plan.id}-${k}`}
                    onBlur={(e) => e.target.value !== plan[k] && void savePlan({ [k]: e.target.value })}
                  />
                </label>
              ))}
              <p className="text-[11px] text-ink-500">VERIFY: confirm the facility crisis line number locally before giving this to the client.</p>
              <div className="flex flex-wrap gap-2">
                {!locked && (
                  <button type="button" className={BTN} onClick={() => void signPlan()}>
                    Sign safety plan
                  </button>
                )}
                {locked && !plan.copy_given_at && (
                  <button type="button" className={BTN} onClick={() => accessToken && void giveSafetyPlanCopy(accessToken, patientId).then(setPlan).catch((e) => setError(errorText(e, "Couldn't record the copy.")))}>
                    Record that the client was given a copy
                  </button>
                )}
                {locked && (
                  <button type="button" className={BTN_GHOST} onClick={() => accessToken && void openSafetyPlan(accessToken, patientId).then(setPlan)}>
                    Start a revision
                  </button>
                )}
                {plan.copy_given_at && <Tag tone="brand">Copy given {new Date(plan.copy_given_at).toLocaleString()}</Tag>}
              </div>
            </div>
          )}
        </Card>
      )}

      {ws.needs_safety_plan && (
        <Card title="Follow-up that makes this safe">
          <fieldset disabled={disabled} className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <label className="flex flex-col gap-1">
              <span className={FIELD_LABEL}>Contact within 72 hours <span className="text-priority-red">*</span></span>
              <input type="datetime-local" className={INPUT} defaultValue={details.contact_72h_at?.slice(0, 16) ?? ""} onBlur={(e) => void saveDetails({ contact_72h_at: e.target.value ? new Date(e.target.value).toISOString() : null })} />
              <span className="text-[11px] text-ink-500">Signing the plan books this contact as a follow-up appointment.</span>
            </label>
            <label className="flex flex-col gap-1">
              <span className={FIELD_LABEL}>Named follow-up clinician <span className="text-priority-red">*</span></span>
              <input className={INPUT} defaultValue={details.follow_up_clinician} onBlur={(e) => void saveDetails({ follow_up_clinician: e.target.value })} />
            </label>
            <label className="flex items-center gap-2 text-[13px] sm:col-span-2">
              <input type="checkbox" checked={details.means_counselling_done} onChange={(e) => void saveDetails({ means_counselling_done: e.target.checked })} />
              Lethal-means counselling done
            </label>
          </fieldset>
        </Card>
      )}
    </div>
  );
}
