import type { ClientBanner } from "../../../lib/carePathwayApi";
import type { BannerOverrides } from "../shared/SafetyBanner";

/** Props every client-record view and journey stage receives. */
export interface RecordViewProps {
  patientId: string;
  banner: ClientBanner;
  /** Refetch the safety banner after a save that can change it. */
  onRecordChanged: () => void;
  /** Show live triage safety changes in the client record's shared banner. */
  onSafetyBannerOverridesChange?: (overrides: BannerOverrides | null) => void;
}
