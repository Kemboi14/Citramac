import { useEffect, useState } from "react";
import { useAuth } from "../../../../auth/useAuth";
import {
  getClientCareTeam,
  getPlanWorkspace,
  giveSafetyPlanCopy,
  openSafetyPlan,
  peekSafetyPlan,
  saveSafetyPlan,
  signSafetyPlan,
  updatePlanDetails,
  type ClientCareTeam,
  type PlanWorkspace,
  type SafetyPlanDoc,
} from "../../../../lib/carePathwayApi";
import { AutoResizeTextarea } from "../../shared/AutoResizeTextarea";
import { formatDateTime } from "../../shared/format";
import { BTN, BTN_GHOST, FIELD_LABEL, INPUT } from "../../shared/styles";
import { Callout, ErrorNote, Tag } from "../../shared/ui";
import { errorText } from "../../triage/helpers";
import { SAFETY_KEYS, SAFETY_LABELS } from "../plan/safetyLabels";

const SECTION =
  "flex flex-col gap-3 border-t border-surface-border pt-4 first:border-t-0 first:pt-0";
const HEADING = "font-display text-sm font-semibold text-ink-900";

/**
 * Safety planning — delivers the care plan's "Safety plan / enhanced observation"
 * action (Interventions → Observation & safety). The client-held safety plan
 * (versioned; a signed plan is never edited), the crisis & relapse plan,
 * lethal-means counselling and the 72-hour contact, which is booked as a
 * follow-up appointment as soon as it is agreed. The follow-up clinician is the
 * episode's care coordinator (EpisodeOfCare.careManager), never a typed name.
 */
export function SafetyPlanModule({ patientId }: { patientId: string }) {
  const { accessToken } = useAuth();
  const [ws, setWs] = useState<PlanWorkspace | null>(null);
  const [team, setTeam] = useState<ClientCareTeam | null>(null);
  const [plan, setPlan] = useState<SafetyPlanDoc | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState("");

  useEffect(() => {
    if (!accessToken) return;
    let live = true;
    Promise.all([
      getPlanWorkspace(accessToken, patientId),
      getClientCareTeam(accessToken, patientId),
      peekSafetyPlan(accessToken, patientId),
    ])
      .then(([w, t, p]) => {
        if (!live) return;
        setWs(w);
        setTeam(t);
        setPlan(p);
      })
      .catch((e) => live && setError(errorText(e, "Couldn't open safety planning.")));
    return () => {
      live = false;
    };
  }, [accessToken, patientId]);

  async function saveDetails(patch: Parameters<typeof updatePlanDetails>[2], message: string) {
    if (!accessToken) return;
    setError(null);
    try {
      setWs(await updatePlanDetails(accessToken, patientId, patch));
      setSaved(message);
    } catch (e) {
      setError(errorText(e, "Couldn't save."));
    }
  }

  async function savePlan(patch: Partial<SafetyPlanDoc>) {
    if (!accessToken || !plan) return;
    setError(null);
    setPlan({ ...plan, ...patch });
    try {
      setPlan(await saveSafetyPlan(accessToken, patientId, patch));
      setSaved("Safety plan draft saved.");
    } catch (e) {
      setError(errorText(e, "Couldn't save the safety plan."));
    }
  }

  async function run(call: () => Promise<SafetyPlanDoc>, fallback: string, message: string) {
    setError(null);
    try {
      setPlan(await call());
      setSaved(message);
    } catch (e) {
      setError(errorText(e, fallback));
    }
  }

  if (!ws) {
    return error ? (
      <ErrorNote>{error}</ErrorNote>
    ) : (
      <p className="text-[13px] text-ink-500">Loading…</p>
    );
  }

  const details = ws.details;
  const labels = SAFETY_LABELS[plan?.language ?? "en"];
  const locked = Boolean(plan?.signed_at);
  const coordinator = team?.coordinator?.name;

  return (
    <div className="flex flex-col gap-4">
      <ErrorNote>{error}</ErrorNote>
      <p role="status" aria-live="polite" className="text-xs text-ink-500 empty:hidden">
        {saved}
      </p>
      {ws.needs_safety_plan && !locked && (
        <Callout tone="warning">
          A suicide-risk finding or the care plan&apos;s safety action calls for a signed safety
          plan.
        </Callout>
      )}

      {!plan ? (
        <section className={SECTION} aria-label="Safety plan">
          <h3 className={HEADING}>Safety plan (client-held)</h3>
          <p className="text-[13px] text-ink-500">
            No safety plan has been written for this client.
          </p>
          <div>
            <button
              type="button"
              className={BTN}
              onClick={() =>
                accessToken &&
                void run(
                  () => openSafetyPlan(accessToken, patientId),
                  "Couldn't start the safety plan.",
                  "Safety plan started.",
                )
              }
            >
              Start the safety plan
            </button>
          </div>
        </section>
      ) : (
        <section className={SECTION} aria-label="Safety plan">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className={HEADING}>Safety plan (client-held)</h3>
            <Tag tone={locked ? "brand" : "warn"}>
              {locked
                ? `Version ${plan.version} signed${plan.signed_by ? ` by ${plan.signed_by}` : ""}`
                : `Version ${plan.version} draft`}
            </Tag>
          </div>
          <p className="text-xs text-ink-500">
            Written with the client, in their own words. A signed plan is never edited; a revision
            is a new version.
          </p>
          <label className="flex max-w-[200px] flex-col gap-1">
            <span className={FIELD_LABEL}>Language of the copy</span>
            <select
              className={INPUT}
              disabled={locked}
              value={plan.language}
              onChange={(e) => void savePlan({ language: e.target.value as "en" | "sw" })}
            >
              <option value="en">English</option>
              <option value="sw">Kiswahili</option>
            </select>
          </label>
          {plan.language === "sw" && (
            <Callout tone="warning">
              Kiswahili labels are a draft — verify with a qualified translator before clinical use.
            </Callout>
          )}
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            {SAFETY_KEYS.map((k) => (
              <label key={`${plan.id}-${k}`} className="flex flex-col gap-1">
                <span className={FIELD_LABEL}>{labels[k]}</span>
                <AutoResizeTextarea
                  rows={2}
                  disabled={locked}
                  defaultValue={plan[k]}
                  onBlur={(e) =>
                    e.target.value !== plan[k] && void savePlan({ [k]: e.target.value })
                  }
                />
              </label>
            ))}
          </div>
          <p className="text-[11px] text-ink-500">
            VERIFY: confirm the facility crisis line number locally before giving this to the
            client.
          </p>
          <div className="flex flex-wrap items-center gap-2">
            {!locked && (
              <button
                type="button"
                className={BTN}
                onClick={() =>
                  accessToken &&
                  void run(
                    () => signSafetyPlan(accessToken, patientId),
                    "Couldn't sign the safety plan.",
                    "Safety plan signed.",
                  )
                }
              >
                Sign safety plan
              </button>
            )}
            {locked && !plan.copy_given_at && (
              <button
                type="button"
                className={BTN}
                onClick={() =>
                  accessToken &&
                  void run(
                    () => giveSafetyPlanCopy(accessToken, patientId),
                    "Couldn't record the copy.",
                    "Copy recorded.",
                  )
                }
              >
                Record that the client was given a copy
              </button>
            )}
            {locked && (
              <button
                type="button"
                className={BTN_GHOST}
                onClick={() =>
                  accessToken &&
                  void run(
                    () => openSafetyPlan(accessToken, patientId),
                    "Couldn't start a revision.",
                    "Revision started.",
                  )
                }
              >
                Start a revision
              </button>
            )}
            {plan.copy_given_at && (
              <Tag tone="brand">Copy given {formatDateTime(plan.copy_given_at)}</Tag>
            )}
          </div>
        </section>
      )}

      <section className={SECTION} aria-label="Crisis and relapse plan">
        <h3 className={HEADING}>Crisis &amp; relapse plan</h3>
        <label className="flex flex-col gap-1">
          <span className={FIELD_LABEL}>
            What the client wants to happen in a crisis or early relapse (warning signs and contacts
            go in the safety plan above)
          </span>
          <AutoResizeTextarea
            rows={3}
            defaultValue={details.crisis_plan}
            onBlur={(e) =>
              e.target.value !== details.crisis_plan &&
              void saveDetails({ crisis_plan: e.target.value }, "Crisis & relapse plan saved.")
            }
          />
        </label>
        <label className="flex items-center gap-2 text-[13px]">
          <input
            type="checkbox"
            checked={details.means_counselling_done}
            onChange={(e) =>
              void saveDetails(
                { means_counselling_done: e.target.checked },
                "Lethal-means counselling saved.",
              )
            }
          />
          Lethal-means counselling done
        </label>
      </section>

      <section className={SECTION} aria-label="72-hour contact">
        <h3 className={HEADING}>Contact within 72 hours</h3>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <label className="flex flex-col gap-1">
            <span className={FIELD_LABEL}>Date and time agreed</span>
            <input
              type="datetime-local"
              className={INPUT}
              defaultValue={details.contact_72h_at?.slice(0, 16) ?? ""}
              onBlur={(e) => {
                const next = e.target.value ? new Date(e.target.value).toISOString() : null;
                if ((details.contact_72h_at ?? null) === next) return;
                void saveDetails(
                  { contact_72h_at: next },
                  next ? "72-hour contact booked as a follow-up appointment." : "Cleared.",
                );
              }}
            />
            <span className="text-[11px] text-ink-500">
              Booked as a follow-up appointment as soon as it is saved.
            </span>
          </label>
          <div className="flex flex-col gap-1">
            <span className={FIELD_LABEL}>Follow-up clinician (care coordinator)</span>
            <span className="py-1.5 text-[13px] text-ink-900">
              {coordinator ?? "Not set — choose the care coordinator on the client's Snapshot"}
            </span>
          </div>
        </div>
      </section>
    </div>
  );
}
