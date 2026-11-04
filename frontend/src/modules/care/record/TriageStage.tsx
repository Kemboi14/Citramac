import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  getTriageEncounter,
  startTriage,
  type TriageEncounterDetail,
} from "../../../lib/carePathwayApi";
import { BTN_GHOST } from "../shared/styles";
import { Card, ErrorNote, PageHeader } from "../shared/ui";
import { EncounterContext } from "../triage/EncounterContext";
import { QuickRecheck } from "../triage/QuickRecheck";
import { TriageForm } from "../triage/TriageForm";
import { TriageFormV4 } from "../triage/TriageFormV4";
import { TriageFormV5 } from "../triage/TriageFormV5";
import type { RecordViewProps } from "./types";
import { useRecordData } from "./useRecordData";

export function TriageStage({
  banner,
  onRecordChanged,
  onSafetyBannerOverridesChange,
}: RecordViewProps) {
  const [reloadVersion, setReloadVersion] = useState(0);
  const encounterId = banner.latest_triage_encounter_id ?? banner.latest_signed_triage_encounter_id;
  const {
    data: encounter,
    error,
    loading,
  } = useRecordData<TriageEncounterDetail>(
    encounterId,
    reloadVersion,
    async (token) => {
      if (!encounterId) throw new Error("No triage encounter is available.");
      let detail = await getTriageEncounter(token, encounterId);
      const needsStart =
        detail.status === "AWAITING" ||
        (detail.status === "IN_TRIAGE" && !detail.triage_started_at);
      if (needsStart) {
        await startTriage(token, encounterId);
        detail = await getTriageEncounter(token, encounterId);
      }
      return detail;
    },
    "Couldn't load the client's triage record.",
  );

  useEffect(() => () => onSafetyBannerOverridesChange?.(null), [onSafetyBannerOverridesChange]);

  function refreshRecord() {
    setReloadVersion((version) => version + 1);
    onRecordChanged();
  }

  if (!encounterId) {
    return (
      <div className="animate-fade-in">
        <PageHeader title="Triage" subtitle="Complete the client's triage before intake" />
        <Card title="No triage encounter">
          <p className="text-[13px] text-ink-700">
            No triage encounter has been recorded for this client. Start the registration and
            arrival process to create one before capturing triage.
          </p>
          <Link to="/clinical/registration" className={`${BTN_GHOST} mt-4 inline-flex`}>
            Go to registration
          </Link>
        </Card>
      </div>
    );
  }

  if (error && !encounter) {
    return (
      <div className="animate-fade-in">
        <PageHeader title="Triage" subtitle="Complete the client's triage before intake" />
        <ErrorNote>{error}</ErrorNote>
        <button
          type="button"
          className={`${BTN_GHOST} mt-3`}
          onClick={() => setReloadVersion((version) => version + 1)}
        >
          Try again
        </button>
      </div>
    );
  }

  if (loading && !encounter) {
    return (
      <div className="animate-fade-in" aria-busy="true">
        <PageHeader title="Triage" subtitle="Loading the client's triage encounter…" />
      </div>
    );
  }
  if (!encounter) return null;

  if (encounter.status === "RECHECK_DUE") {
    return (
      <div className="animate-fade-in">
        <EncounterContext detail={encounter} banner={banner} />
        <PageHeader
          title="Triage re-check"
          subtitle="Record what has changed and repeat observations only when taken"
        />
        <QuickRecheck
          key={encounter.id}
          detail={encounter}
          embedded
          onSigned={refreshRecord}
          onFullRetriage={() => setReloadVersion((version) => version + 1)}
        />
      </div>
    );
  }

  const props = {
    detail: encounter,
    banner,
    bannerError: null,
    embedded: true,
    onSigned: refreshRecord,
  };
  if (encounter.schema === "v5") return <TriageFormV5 key={encounter.id} {...props} />;
  if (encounter.schema === "v4") return <TriageFormV4 key={encounter.id} {...props} />;
  return (
    <TriageForm
      key={encounter.id}
      {...props}
      onSafetyBannerOverridesChange={onSafetyBannerOverridesChange}
    />
  );
}
