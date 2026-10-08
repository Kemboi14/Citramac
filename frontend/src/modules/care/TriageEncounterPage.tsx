import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useAuth } from "../../auth/useAuth";
import {
  getTriageEncounter,
  startTriage,
  type TriageEncounterDetail,
} from "../../lib/carePathwayApi";
import { SafetyBanner } from "./shared/SafetyBanner";
import { BTN_GHOST } from "./shared/styles";
import { ErrorNote, PageHeader } from "./shared/ui";
import { useClientBanner } from "./shared/useClientBanner";
import { EncounterContext } from "./triage/EncounterContext";
import { QuickRecheck } from "./triage/QuickRecheck";
import { TriageForm } from "./triage/TriageForm";
import { errorText } from "./triage/helpers";
import { Breadcrumbs } from "./shared/Breadcrumbs";

// docs/15-CLINICAL-WORKSPACE-V3.md §1.6 / §1.7 — /clinical/triage/:triageId.
// A "Re-check due" encounter opens the quick re-check; anything else opens the
// full triage. Opening an open encounter marks it In triage (mockup triage()).

export function TriageEncounterPage() {
  const { triageId } = useParams();
  const { accessToken } = useAuth();
  const navigate = useNavigate();
  const [detail, setDetail] = useState<TriageEncounterDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  // Bumped only when the screen switches from re-check to a full re-triage, so
  // a reload after signing keeps the signed form (and its read-only state).
  const [formKey, setFormKey] = useState(0);
  const { banner, error: bannerError } = useClientBanner(detail?.patient_id, reloadKey);

  useEffect(() => {
    if (!accessToken || !triageId) return;
    let cancelled = false;
    (async () => {
      let data = await getTriageEncounter(accessToken, triageId);
      const open =
        data.status === "AWAITING" || (data.status === "IN_TRIAGE" && !data.triage_started_at);
      if (open) {
        await startTriage(accessToken, triageId);
        data = await getTriageEncounter(accessToken, triageId);
      }
      if (cancelled) return;
      setDetail(data);
      setError(null);
    })().catch((err) => {
      if (cancelled) return;
      setError(errorText(err, "Couldn't open this triage encounter — check your connection."));
    });
    return () => {
      cancelled = true;
    };
  }, [accessToken, triageId, reloadKey]);

  if (error && !detail) {
    return (
      <div className="mx-auto max-w-[1600px]">
        <ErrorNote>{error}</ErrorNote>
        <button
          type="button"
          className={`${BTN_GHOST} mt-3`}
          onClick={() => navigate("/clinical/triage")}
        >
          Back to queue
        </button>
      </div>
    );
  }
  if (!detail) {
    return (
      <div className="mx-auto max-w-[1600px]" aria-busy="true">
        <SafetyBanner banner={null} />
      </div>
    );
  }

  if (detail.status === "RECHECK_DUE") {
    return (
      <div className="mx-auto max-w-[1600px]">
        <Breadcrumbs
          items={[
            { label: "Triage", to: "/clinical/triage" },
            { label: banner ? banner.name.trim() || "Temporary client (unnamed)" : "Encounter" },
          ]}
        />
        <SafetyBanner banner={banner} error={bannerError} />
        <EncounterContext detail={detail} banner={banner} />
        <PageHeader
          title="Triage re-check"
          subtitle="Record what has changed and repeat observations only when taken"
          actions={
            <button
              type="button"
              className={BTN_GHOST}
              onClick={() => navigate("/clinical/triage")}
            >
              Back to queue
            </button>
          }
        />
        <QuickRecheck
          key={detail.id}
          detail={detail}
          onFullRetriage={() => {
            setFormKey((k) => k + 1);
            setReloadKey((k) => k + 1);
          }}
        />
      </div>
    );
  }

  return (
    <TriageForm
      key={`${detail.id}:${formKey}`}
      detail={detail}
      banner={banner}
      bannerError={bannerError}
      onSigned={() => setReloadKey((k) => k + 1)}
    />
  );
}
