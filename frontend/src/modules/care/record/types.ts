import type { ClientBanner } from "../../../lib/carePathwayApi";

/** Props every client-record view and journey stage receives. */
export interface RecordViewProps {
  patientId: string;
  banner: ClientBanner;
  /** Refetch the safety banner after a save that can change it. */
  onRecordChanged: () => void;
}
