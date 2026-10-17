import { useEffect, useState } from "react";
import { useAuth } from "../../../auth/useAuth";
import { getInstruments, type InstrumentDef } from "../../../lib/carePathwayApi";
import {
  getClientFollowUps,
  getDischargeChecklist,
  getOutcomesOverview,
  type ClientFollowUps,
  type DischargeChecklist,
} from "../../../lib/carePlanOutcomesApi";
import { PageHeader, ErrorNote } from "../shared/ui";
import { DischargePanel } from "./outcomes/DischargePanel";
import { FollowUpPanel } from "./outcomes/FollowUpPanel";
import { MeasuresPanel } from "./outcomes/MeasuresPanel";
import { OverviewPanel, type OutcomeTab } from "./outcomes/OverviewPanel";
import type { RecordViewProps } from "./types";
import { useRecordData } from "./useRecordData";

const TABS: { key: OutcomeTab; label: string }[] = [
  { key: "overview", label: "Overview" },
  { key: "measures", label: "Measures" },
  { key: "discharge", label: "Discharge" },
  { key: "followup", label: "Follow-up" },
];

/** Outcomes — mockup v4 stage 6: baseline and repeat measures, the planned-
 * discharge checklist and episode outcome, and follow-up for this episode.
 * Scores entered anywhere in the record appear here (one store). */
export function OutcomesStage({ patientId, banner, onRecordChanged }: RecordViewProps) {
  const { accessToken } = useAuth();
  const [version, setVersion] = useState(0);
  const [tab, setTab] = useState<OutcomeTab>("overview");
  const { data: overview, error } = useRecordData(
    patientId,
    version,
    (token) => getOutcomesOverview(token, patientId),
    "Couldn't load outcomes.",
  );
  const [defs, setDefs] = useState<InstrumentDef[]>([]);
  const [checklist, setChecklist] = useState<DischargeChecklist | null>(null);
  const [followUps, setFollowUps] = useState<ClientFollowUps | null>(null);

  useEffect(() => {
    if (!accessToken) return;
    void getInstruments(accessToken).then((r) => setDefs(r.results)).catch(() => undefined);
  }, [accessToken]);

  useEffect(() => {
    if (!accessToken) return;
    let cancelled = false;
    getClientFollowUps(accessToken, patientId)
      .then((r) => !cancelled && setFollowUps(r))
      .catch(() => undefined);
    // No open episode answers 400 — the checklist simply does not apply then.
    getDischargeChecklist(accessToken, patientId)
      .then((r) => !cancelled && setChecklist(r))
      .catch(() => !cancelled && setChecklist(null));
    return () => {
      cancelled = true;
    };
  }, [accessToken, patientId, version]);

  const refresh = () => {
    setVersion((v) => v + 1);
    onRecordChanged();
  };
  const name = banner.name.trim() || "Temporary client (unnamed)";

  return (
    <div>
      <PageHeader title="Outcomes" subtitle={`Measures, discharge and follow-up for ${name}`} />
      <ErrorNote>{error}</ErrorNote>
      <div role="tablist" aria-label="Outcomes sections" className="mb-4 flex flex-wrap gap-1.5 border-b border-surface-border">
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            role="tab"
            aria-selected={tab === t.key}
            onClick={() => setTab(t.key)}
            className={`-mb-px border-b-2 px-3 py-[9px] text-[13px] font-semibold ${tab === t.key ? "border-brand-green text-ink-900" : "border-transparent text-ink-500 hover:text-ink-900"}`}
          >
            {t.label}
          </button>
        ))}
      </div>
      {!overview ? (
        <p className="text-[13px] text-ink-500">Loading…</p>
      ) : (
        <div role="tabpanel">
          {tab === "overview" && <OverviewPanel overview={overview} checklist={checklist} followUps={followUps} onOpen={setTab} />}
          {tab === "measures" && <MeasuresPanel patientId={patientId} overview={overview} defs={defs} onRecorded={refresh} />}
          {tab === "discharge" && <DischargePanel patientId={patientId} overview={overview} checklist={checklist} onChanged={refresh} />}
          {tab === "followup" && (
            <FollowUpPanel
              patientId={patientId}
              clientName={name}
              data={followUps}
              onChanged={(next) => (next ? setFollowUps(next) : setVersion((v) => v + 1))}
            />
          )}
        </div>
      )}
    </div>
  );
}
