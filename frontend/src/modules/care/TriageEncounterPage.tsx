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
import { TriageFormV4 } from "./triage/TriageFormV4";
import { TriageFormV5 } from "./triage/TriageFormV5";
import { errorText } from "./triage/helpers";
import { Breadcrumbs } from "./shared/Breadcrumbs";

// docs/15-CLINICAL-WORKSPACE-V3.md §1.6 / §1.7 — /clinical/triage/:triageId.
// A "Re-check due" encounter opens the quick re-check; anything else opens the
// full triage. Opening an open encounter marks it In triage (mockup triage()).

export function TriageEncounterPage() {
  const { triageId } = useParams();
  return <TriageEncounterScreen triageId={triageId} />;
}

/**
 * The one triage screen. The triage queue and dashboard open it at
 * /clinical/triage/:triageId; the client record's Triage tab shows the same
 * screen for the client's latest encounter, so the two can never differ.
 * `onChanged` lets a host refresh what it shows after a signature.
 */
export function TriageEncounterScreen({
  triageId,
  onChanged,
}: {
  triageId: string | undefined;
  onChanged?: () => void;
}) {
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

  // A refresh that fails after the encounter is open keeps the last good copy
  // on screen and says so (the error used to be stored but never shown).
  const stale = error ? (
    <div className="mx-auto mb-3 max-w-[1600px]">
      <ErrorNote>{error}</ErrorNote>
    </div>
  ) : null;

  if (detail.status === "RECHECK_DUE") {
    return (
      <div className="mx-auto max-w-[1600px]">
        {stale}
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

  // New and in-progress triages use the v5 model (the triage developer
  // specification); a record signed under the v4 or v3 rules is shown on the
  // form it was signed with, exactly as it was signed.
  if (detail.schema === "v5") {
    return (
      <>
        {stale}
        <TriageFormV5
          key={`${detail.id}:${formKey}`}
          detail={detail}
          banner={banner}
          bannerError={bannerError}
          onSigned={() => {
            setReloadKey((k) => k + 1);
            onChanged?.();
          }}
        />
      </>
    );
  }

  if (detail.schema === "v4") {
    return (
      <>
        {stale}
        <TriageFormV4
          key={`${detail.id}:${formKey}`}
          detail={detail}
          banner={banner}
          bannerError={bannerError}
          onSigned={() => {
            setReloadKey((k) => k + 1);
            onChanged?.();
          }}
        />
      </>
    );
  }

  return (
    <>
      {stale}
      <TriageForm
        key={`${detail.id}:${formKey}`}
        detail={detail}
        banner={banner}
        bannerError={bannerError}
        onSigned={() => {
          setReloadKey((k) => k + 1);
          onChanged?.();
        }}
      />
    </>
  );
}
