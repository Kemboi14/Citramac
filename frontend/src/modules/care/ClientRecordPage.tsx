import { useCallback, useEffect, useState } from "react";
import { Link, Navigate, useLocation, useParams } from "react-router-dom";
import { usePatientContext } from "../../clinical/usePatientContext";
import { ClientRegistryLookupModal } from "../clinical/ClientRegistryLookup";
import { ClientRecordNav } from "./shared/ClientRecordNav";
import { MergeHistory } from "./shared/MergeHistory";
import { clientRecordPath, JOURNEY_KEYS, type RecordView } from "./shared/recordRoutes";
import { SafetyBanner } from "./shared/SafetyBanner";
import { BTN_GHOST, BTN_SM } from "./shared/styles";
import { Callout } from "./shared/ui";
import { notifyClientChanged, useClientBanner } from "./shared/useClientBanner";
import { BillingStage } from "./record/BillingStage";
import { CarePlanStage } from "./record/plan/CarePlanWorkspace";
import { ChartsView } from "./record/ChartsView";
import { FollowUpStage } from "./record/FollowUpStage";
import { IntakeStage } from "./record/IntakeStage";
import { InterventionsStage } from "./record/InterventionsStage";
import { DocumentLibrary } from "../../components/DocumentLibrary";
import { LegalView } from "./record/LegalView";
import { MseView } from "./record/MseView";
import { OutcomesStage } from "./record/OutcomesStage";
import { SnapshotView } from "./record/SnapshotView";
import { TimelineView } from "./record/TimelineView";
import { TriageStage } from "./record/TriageStage";
import type { RecordViewProps } from "./record/types";
import { Breadcrumbs, carriedTrail, type Crumb } from "./shared/Breadcrumbs";

const VIEWS = new Set<string>([
  "snapshot",
  "timeline",
  "charts",
  "mse",
  "legal",
  "attachments",
  "triage",
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
    case "mse":
      return <MseView {...props} />;
    case "legal":
      return <LegalView {...props} />;
    case "attachments":
      return <DocumentLibrary patientId={props.patientId} />;
    case "triage":
      return <TriageStage {...props} />;
    case "intake":
      return <IntakeStage {...props} />;
    case "care-plan":
      return <CarePlanStage {...props} />;
    case "interventions":
      return <InterventionsStage {...props} />;
    case "outcomes":
      return <OutcomesStage {...props} />;
    case "billing":
      return <BillingStage {...props} />;
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
  const { banner, error } = useClientBanner(patientId || undefined, 0, JOURNEY_KEYS.has(view));
  const { selected, selectPatient } = usePatientContext();
  // A save in any tab of the record reloads this banner, every other banner open
  // for the client on this page, and the user's other tabs (useClientBanner).
  const onRecordChanged = useCallback(() => notifyClientChanged(patientId), [patientId]);
  const [registryOpen, setRegistryOpen] = useState(false);
  // The way the user came in (Clients, a client report, …). Switching tabs
  // changes the URL without it, so it is kept for as long as this client is open.
  const carried = carriedTrail(useLocation().state);
  const [came, setCame] = useState<{ id: string; trail: Crumb[] } | null>(
    carried ? { id: patientId, trail: carried } : null,
  );
  if (carried && (came?.id !== patientId || came.trail !== carried)) {
    setCame({ id: patientId, trail: carried });
  }
  const trailBefore =
    came?.id === patientId ? came.trail : [{ label: "My Caseload", to: "/clinical/caseload" }];

  // Keep the older clinical screens pointed at this client.
  const bannerId = banner?.patient_id;
  const bannerName = banner?.name;
  const selectedId = selected?.patientId;
  useEffect(() => {
    if (bannerId && bannerName !== undefined && selectedId !== bannerId) {
      selectPatient(bannerId, bannerName.trim() || "Temporary client (unnamed)");
    }
  }, [bannerId, bannerName, selectedId, selectPatient]);

  if (!VIEWS.has(view)) return <Navigate to={clientRecordPath(patientId, "triage")} replace />;
  if (banner && banner.opened_as === patientId) {
    // A temporary record merged into an identified client: open the client.
    return <Navigate to={clientRecordPath(banner.patient_id, view as RecordView)} replace />;
  }
  const active = view as RecordView;
  const loadedBanner = banner && banner.patient_id === patientId ? banner : null;

  let body = null;
  if (loadedBanner) {
    const props: RecordViewProps = {
      patientId,
      banner: loadedBanner,
      onRecordChanged,
    };
    const needsSignedTriage =
      JOURNEY_KEYS.has(active) &&
      active !== "triage" &&
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
    <div className="clinical-readable">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <Breadcrumbs
          items={[
            ...trailBefore,
            {
              label: loadedBanner
                ? loadedBanner.name.trim() || "Temporary client (unnamed)"
                : "Client",
            },
          ]}
        />
        {loadedBanner && (
          <div className="mb-2 flex flex-wrap gap-2">
            {loadedBanner.identity_status === "IDENTIFIED" && (
              <button
                type="button"
                className={`${BTN_GHOST} ${BTN_SM}`}
                onClick={() => setRegistryOpen(true)}
              >
                Look up in Client Registry
              </button>
            )}
            <Link
              className={`${BTN_GHOST} ${BTN_SM}`}
              to={`/clinical/registration?${
                loadedBanner.identity_status === "IDENTIFIED" ? "edit" : "resolve"
              }=${encodeURIComponent(patientId)}`}
            >
              {loadedBanner.identity_status === "IDENTIFIED"
                ? "Edit client details"
                : "Resolve identity"}
            </Link>
          </div>
        )}
      </div>
      <ClientRegistryLookupModal
        open={registryOpen}
        patientId={patientId}
        onClose={() => setRegistryOpen(false)}
        onConfirmed={onRecordChanged}
      />
      <SafetyBanner banner={loadedBanner} error={error} />
      <ClientRecordNav patientId={patientId} view={active} banner={loadedBanner} />
      {loadedBanner && <MergeHistory patientId={patientId} onChanged={onRecordChanged} />}
      {body}
    </div>
  );
}
