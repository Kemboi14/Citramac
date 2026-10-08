import { useCallback, useEffect, useState } from "react";
import { Navigate, useParams } from "react-router-dom";
import { usePatientContext } from "../../clinical/usePatientContext";
import { ClientRecordNav } from "./shared/ClientRecordNav";
import { clientRecordPath, JOURNEY_KEYS, type RecordView } from "./shared/recordRoutes";
import { SafetyBanner } from "./shared/SafetyBanner";
import { Callout } from "./shared/ui";
import { useClientBanner } from "./shared/useClientBanner";
import { BillingStage } from "./record/BillingStage";
import { CarePlanStage } from "./record/CarePlanStage";
import { ChartsView } from "./record/ChartsView";
import { FollowUpStage } from "./record/FollowUpStage";
import { IntakeStage } from "./record/IntakeStage";
import { InterventionsStage } from "./record/InterventionsStage";
import { LegalView } from "./record/LegalView";
import { OutcomesStage } from "./record/OutcomesStage";
import { SnapshotView } from "./record/SnapshotView";
import { TimelineView } from "./record/TimelineView";
import type { RecordViewProps } from "./record/types";
import { Breadcrumbs } from "./shared/Breadcrumbs";

const VIEWS = new Set<string>([
  "snapshot",
  "timeline",
  "charts",
  "legal",
  "intake",
  "care-plan",
  "interventions",
  "outcomes",
  "billing",
  "follow-up",
]);

function renderView(view: RecordView, props: RecordViewProps) {
  switch (view) {
    case "snapshot":
      return <SnapshotView {...props} />;
    case "timeline":
      return <TimelineView {...props} />;
    case "charts":
      return <ChartsView {...props} />;
    case "legal":
      return <LegalView {...props} />;
    case "intake":
      return <IntakeStage {...props} />;
    case "care-plan":
      return <CarePlanStage {...props} />;
    case "interventions":
      return <InterventionsStage {...props} />;
    case "outcomes":
      return <OutcomesStage {...props} />;
    case "billing":
      return <BillingStage patientId={props.patientId} />;
    case "follow-up":
      return <FollowUpStage {...props} />;
  }
}

/**
 * Client Record (psychiatric review) — docs/15-CLINICAL-WORKSPACE-V3.md §1.9;
 * mockup `patientRecordView()`: safety banner, record-view tabs, journey-stage
 * tabs, then the active view. Built natively (no iframe, conflict C7).
 */
export function ClientRecordPage() {
  const { patientId = "", view = "" } = useParams<{ patientId: string; view: string }>();
  const [reloadKey, setReloadKey] = useState(0);
  const { banner, error } = useClientBanner(patientId || undefined, reloadKey);
  const { selected, selectPatient } = usePatientContext();
  const onRecordChanged = useCallback(() => setReloadKey((k) => k + 1), []);

  // Keep the older clinical screens pointed at this client.
  const bannerId = banner?.patient_id;
  const bannerName = banner?.name;
  const selectedId = selected?.patientId;
  useEffect(() => {
    if (bannerId && bannerName !== undefined && selectedId !== bannerId) {
      selectPatient(bannerId, bannerName.trim() || "Temporary client (unnamed)");
    }
  }, [bannerId, bannerName, selectedId, selectPatient]);

  if (!VIEWS.has(view)) return <Navigate to={clientRecordPath(patientId, "intake")} replace />;
  const active = view as RecordView;
  const loadedBanner = banner && banner.patient_id === patientId ? banner : null;

  let body = null;
  if (loadedBanner) {
    const props: RecordViewProps = { patientId, banner: loadedBanner, onRecordChanged };
    const needsSignedTriage =
      JOURNEY_KEYS.has(active) &&
      active !== "follow-up" &&
      !loadedBanner.latest_signed_triage_encounter_id;
    if (needsSignedTriage) {
      body = (
        <Callout role="alert">
          A signed triage record is required before opening the Psychiatry workflow.
        </Callout>
      );
    } else {
      body = renderView(active, props);
    }
  }

  return (
    <div>
      <Breadcrumbs
        items={[
          { label: "My Caseload", to: "/clinical/caseload" },
          {
            label: loadedBanner
              ? loadedBanner.name.trim() || "Temporary client (unnamed)"
              : "Client",
          },
        ]}
      />
      <SafetyBanner banner={loadedBanner} error={error} />
      <ClientRecordNav patientId={patientId} view={active} />
      {body}
    </div>
  );
}
