import { useEffect, useState } from "react";
import { useAuth } from "../../../../auth/useAuth";
import {
  getPlanWorkspace,
  updatePlanDetails,
  type PlanWorkspace,
} from "../../../../lib/carePathwayApi";
import { AutoResizeTextarea } from "../../shared/AutoResizeTextarea";
import { FIELD_LABEL } from "../../shared/styles";
import { Card, ErrorNote } from "../../shared/ui";
import { errorText } from "../../triage/helpers";

const FAMILY_CONSENT: Record<PlanWorkspace["family_consent"], string> = {
  NOT_ASKED: "not yet asked",
  YES: "client agrees",
  NO: "client declined — do not involve family",
  RESTRICTED: "restricted to the treating facility",
};

/** What the client has agreed about family / carer involvement, and their advance
 * statement and treatment preferences. Held on the episode's care plan and
 * signed into each plan version; recorded here beside the consents they depend on. */
export function FamilyAdvanceWishesCard({ patientId }: { patientId: string }) {
  const { accessToken } = useAuth();
  const [ws, setWs] = useState<PlanWorkspace | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState("");

  useEffect(() => {
    if (!accessToken) return;
    let live = true;
    getPlanWorkspace(accessToken, patientId)
      .then((w) => live && setWs(w))
      .catch((e) => live && setError(errorText(e, "Couldn't load family and advance wishes.")));
    return () => {
      live = false;
    };
  }, [accessToken, patientId]);

  async function save(patch: { family_involvement?: string; advance_statement?: string }) {
    if (!accessToken) return;
    setError(null);
    try {
      setWs(await updatePlanDetails(accessToken, patientId, patch));
      setSaved("Saved.");
    } catch (e) {
      setError(errorText(e, "Couldn't save."));
    }
  }

  return (
    <Card title="Family involvement & advance wishes">
      <ErrorNote>{error}</ErrorNote>
      {!ws ? (
        !error && <p className="text-[13px] text-ink-500">Loading…</p>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <label className="flex flex-col gap-1">
            <span className={FIELD_LABEL}>
              Family / carer involvement (consent: {FAMILY_CONSENT[ws.family_consent]})
            </span>
            <AutoResizeTextarea
              rows={3}
              defaultValue={ws.details.family_involvement}
              onBlur={(e) =>
                e.target.value !== ws.details.family_involvement &&
                void save({ family_involvement: e.target.value })
              }
            />
            {ws.family_consent === "NO" && (
              <span role="alert" className="text-[11px] font-semibold text-priority-red">
                The client declined family involvement — record only what the client has agreed to
                share.
              </span>
            )}
          </label>
          <label className="flex flex-col gap-1">
            <span className={FIELD_LABEL}>Advance statement &amp; treatment preferences</span>
            <AutoResizeTextarea
              rows={3}
              defaultValue={ws.details.advance_statement}
              onBlur={(e) =>
                e.target.value !== ws.details.advance_statement &&
                void save({ advance_statement: e.target.value })
              }
            />
          </label>
          <p role="status" aria-live="polite" className="text-xs text-ink-500 empty:hidden">
            {saved}
          </p>
        </div>
      )}
    </Card>
  );
}
