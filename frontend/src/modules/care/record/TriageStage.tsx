import { Link } from "react-router-dom";
import { TriageEncounterScreen } from "../TriageEncounterPage";
import { BTN_GHOST } from "../shared/styles";
import { Card, PageHeader } from "../shared/ui";
import type { RecordViewProps } from "./types";

/**
 * The client record's Triage tab shows the same triage screen the dashboard and
 * triage queue open (/clinical/triage/:id), for the client's latest encounter.
 */
export function TriageStage({ banner, onRecordChanged }: RecordViewProps) {
  const encounterId = banner.latest_triage_encounter_id ?? banner.latest_signed_triage_encounter_id;

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

  return (
    <TriageEncounterScreen key={encounterId} triageId={encounterId} onChanged={onRecordChanged} />
  );
}
