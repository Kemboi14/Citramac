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
import { errorText } from "../../triage/helpers";
import { BTN, BTN_GHOST, FIELD_LABEL, INPUT } from "../../shared/styles";
import { Callout, Card, ErrorNote, Tag } from "../../shared/ui";

const AGREEMENT = [
  { code: "AGREES", display: "Client agrees with the plan" },
  { code: "PARTIAL", display: "Client agrees with part of the plan" },
  { code: "DISAGREES", display: "Client disagrees" },
  { code: "UNABLE", display: "Client unable to take part now" },
];

const SAFETY_LABELS: Record<"en" | "sw", Record<string, string>> = {
  en: {
    title: "My safety plan",
    warning_signs: "Warning signs that a crisis may be starting",
    coping: "Things I can do on my own to cope",
    self_talk: "Things I can say to myself",
    places_people_distract: "People and places that help take my mind off things",
    people_to_ask: "People I can ask for help",
    professionals: "Professionals and crisis lines",
    safer_surroundings: "Making my surroundings safer",
    reasons_for_living: "My reasons for living",
    keepsake: "What I keep with this plan (a photo, a letter, an object)",
  },
  sw: {
    title: "Mpango wangu wa usalama",
    warning_signs: "Ishara za tahadhari kwamba shida inaanza",
    coping: "Mambo ninayoweza kufanya mwenyewe kujituliza",
    self_talk: "Maneno ninayoweza kujiambia",
    places_people_distract: "Watu na mahali panaponisaidia kusahau",
    people_to_ask: "Watu ninaoweza kuomba msaada",
    professionals: "Wataalamu na nambari za dharura",
    safer_surroundings: "Kufanya mazingira yangu kuwa salama zaidi",
    reasons_for_living: "Sababu zangu za kuishi",
    keepsake: "Ninachoweka pamoja na mpango huu (picha, barua, kitu)",
  },
};
const KEYS = ["warning_signs", "coping", "self_talk", "places_people_distract", "people_to_ask", "professionals", "safer_surroundings", "reasons_for_living", "keepsake"] as const;

/** With the client: agreement, what matters, the written client-held safety
 * plan, and the follow-up contact that makes it safe to go home. */
export function ClientTab({
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
  const [seniors, setSeniors] = useState<{ id: string; name: string }[]>([]);
  const [details, setDetails] = useState(ws.details);
  const [plan, setPlan] = useState<SafetyPlanDoc | null>(null);

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

  const labels = SAFETY_LABELS[plan?.language ?? "en"];
  const locked = Boolean(plan?.signed_at);
  return (
    <div className="flex flex-col gap-4">
      <ErrorNote>{error}</ErrorNote>
      <Card title="Agreement and what matters">
        <fieldset disabled={disabled} className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <label className="flex flex-col gap-1">
            <span className={FIELD_LABEL}>Client agreement <span className="text-priority-red">*</span></span>
            <select className={INPUT} value={details.client_agreement} onChange={(e) => void saveDetails({ client_agreement: e.target.value as typeof details.client_agreement })}>
              <option value="">— select —</option>
              {AGREEMENT.map((o) => (
                <option key={o.code} value={o.code}>{o.display}</option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1">
            <span className={FIELD_LABEL}>What matters most to the client right now?</span>
            <input className={INPUT} defaultValue={details.what_matters} onBlur={(e) => void saveDetails({ what_matters: e.target.value })} />
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
              <h3 className="font-display text-sm font-semibold">{labels.title}</h3>
              {KEYS.map((k) => (
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
