import { useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { getTherapy, type TherapyState } from "../../../../lib/carePathwayApi";
import { BTN, BTN_GHOST, BTN_SM, FIELD_LABEL, INPUT } from "../../shared/styles";
import { ErrorNote } from "../../shared/ui";
import { PsychotherapyWorkspace } from "../modules/psychotherapy/Workspace";
import { PsychotherapyPlanCard } from "../modules/psychotherapy/NotePanel";
import { AutoResizeTextarea } from "../../shared/AutoResizeTextarea";
import { TherapyModule } from "../modules/TherapyModule";
import { useModule } from "../modules/useModule";

/** Psychotherapy Record tab (v4 `psyWorkflowMount`): the guided session itself.
 * A session note belongs to a therapy episode whose limits of confidentiality
 * are agreed, so until one exists the episode is set up here first. Signing the
 * note records the delivery — nothing is entered twice. */
export function PsychotherapyRecord({
  patientId,
  initialEpisodeId,
  onClose,
  header,
  backLabel = "Interventions",
}: {
  patientId: string;
  initialEpisodeId?: string;
  onClose: () => void;
  /** The module's back link and header, shown until the session workspace
   * (which has its own) opens. */
  header?: ReactNode;
  /** Where the workspace's back crumb returns to. */
  backLabel?: string;
}) {
  const { data, error } = useModule<TherapyState>(patientId, getTherapy);
  const ready = (data?.results ?? []).filter((e) => !e.ended && e.confidentiality_agreed);
  const [chosen, setChosen] = useState<string | null>(initialEpisodeId ?? null);
  const [launched, setLaunched] = useState(false);
  const [scheduleMode, setScheduleMode] = useState(false);
  const [sessionType, setSessionType] = useState<"INDIVIDUAL" | "FAMILY">("INDIVIDUAL");
  const [sessionObjective, setSessionObjective] = useState("");
  const [primaryGoal, setPrimaryGoal] = useState("");
  const [secondaryGoals, setSecondaryGoals] = useState("");
  const episodeId = chosen ?? (ready.length === 1 ? ready[0].id : null);

  if (error)
    return (
      <>
        {header}
        <div className="p-6">
          <ErrorNote>{error}</ErrorNote>
        </div>
      </>
    );
  if (!data)
    return (
      <>
        {header}
        <p className="p-6 text-[13px] text-ink-500">Loading…</p>
      </>
    );
  if (episodeId && launched) {
    return (
      <PsychotherapyWorkspace
        inline
        patientId={patientId}
        episodeId={episodeId}
        sessionType={sessionType}
        sessionObjective={sessionObjective}
        primaryGoal={primaryGoal}
        secondaryGoals={secondaryGoals}
        onClose={onClose}
        backLabel={backLabel}
      />
    );
  }
  if (episodeId && !launched) {
    const ep = ready.find((e) => e.id === episodeId);
    return (
      <>
        {header}
        <div className="p-6 flex flex-col gap-3">
          <h3 className="text-sm font-bold text-ink-900">Session details</h3>
          <p className="text-xs text-ink-700">
            Modality: {ep?.modality ?? "—"}
            {ep?.activity_title ? ` · ${ep.activity_title}` : ""}
          </p>
          <label className="text-xs">
            <span className="block text-[11px] font-semibold text-ink-700">Session type</span>
            <select
              className="mt-1 rounded border border-surface-border px-2 py-1 text-xs"
              value={sessionType}
              onChange={(e) => setSessionType(e.target.value as "INDIVIDUAL" | "FAMILY")}
            >
              <option value="INDIVIDUAL">Individual</option>
              <option value="FAMILY">Family</option>
            </select>
          </label>
          <label className={FIELD_LABEL}>
            Session objective
            <AutoResizeTextarea className={`${INPUT} min-h-[64px]`} rows={2} value={sessionObjective} onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setSessionObjective(e.target.value)} placeholder="e.g. To process a specific traumatic memory" />
          </label>
          <label className={FIELD_LABEL}>
            Primary goal
            <AutoResizeTextarea className={`${INPUT} min-h-[64px]`} rows={2} value={primaryGoal} onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setPrimaryGoal(e.target.value)} placeholder="e.g. Help the client process trauma-related emotions" />
          </label>
          <label className={FIELD_LABEL}>
            Secondary goals
            <AutoResizeTextarea className={`${INPUT} min-h-[64px]`} rows={2} value={secondaryGoals} onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setSecondaryGoals(e.target.value)} placeholder="e.g. Enhance self-awareness of trauma triggers" />
          </label>
          <div className="flex gap-2">
            <button type="button" className={`${BTN} ${BTN_SM}`} onClick={() => setLaunched(true)}>
              Start session
            </button>
            <button
              type="button"
              className={`${BTN_GHOST} ${BTN_SM}`}
              onClick={() => setScheduleMode((v) => !v)}
            >
              {scheduleMode ? "Hide scheduling" : "Schedule instead"}
            </button>
            <button type="button" className={`${BTN_GHOST} ${BTN_SM}`} onClick={onClose}>
              Cancel
            </button>
          </div>
          {scheduleMode && <PsychotherapyPlanCard patientId={patientId} />}
          <p className="text-xs text-ink-500">
            Group sessions are documented in Group psychotherapy.
          </p>
        </div>
      </>
    );
  }
  return (
    <>
      {header}
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto flex w-full max-w-[1120px] flex-col gap-3 px-[clamp(18px,4vw,48px)] py-6">
          {ready.length > 1 ? (
            <div className="flex flex-col gap-2">
              <p className="text-[13px] text-ink-700">
                Choose the therapy episode this session belongs to.
              </p>
              <div className="flex flex-wrap gap-2">
                {ready.map((e) => (
                  <button
                    key={e.id}
                    type="button"
                    className={`${BTN_GHOST} ${BTN_SM}`}
                    onClick={() => setChosen(e.id)}
                  >
                    {e.modality}
                    {e.activity_title ? ` · ${e.activity_title}` : ""}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <TherapyModule patientId={patientId} />
          )}
          <p className="text-xs text-ink-500">
            Group sessions are documented once in{" "}
            <Link
              to="/clinical/psychotherapy/group"
              className="font-semibold text-brand-green hover:underline"
            >
              Group psychotherapy
            </Link>
            ; each attendee’s entry is listed on their record.
          </p>
        </div>
      </div>
    </>
  );
}
