import { useState } from "react";
import { Link } from "react-router-dom";
import { getTherapy, type TherapyState } from "../../../../lib/carePathwayApi";
import { BTN_GHOST, BTN_SM } from "../../shared/styles";
import { ErrorNote } from "../../shared/ui";
import { PsychotherapyWorkspace } from "../modules/psychotherapy/Workspace";
import { TherapyModule } from "../modules/TherapyModule";
import { useModule } from "../modules/useModule";

/** Psychotherapy Record tab (v4 `psyWorkflowMount`): the guided session itself.
 * A session note belongs to a therapy episode whose limits of confidentiality
 * are agreed, so until one exists the episode is set up here first. Signing the
 * note records the delivery — nothing is entered twice. */
export function PsychotherapyRecord({
  patientId,
  onClose,
}: {
  patientId: string;
  onClose: () => void;
}) {
  const { data, error } = useModule<TherapyState>(patientId, getTherapy);
  const ready = (data?.results ?? []).filter((e) => !e.ended && e.confidentiality_agreed);
  const [chosen, setChosen] = useState<string | null>(null);
  const episodeId = chosen ?? (ready.length === 1 ? ready[0].id : null);

  if (error) return <div className="p-6"><ErrorNote>{error}</ErrorNote></div>;
  if (!data) return <p className="p-6 text-[13px] text-ink-500">Loading…</p>;
  if (episodeId) {
    return <PsychotherapyWorkspace inline patientId={patientId} episodeId={episodeId} onClose={onClose} />;
  }
  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto flex w-full max-w-[1120px] flex-col gap-3 px-[clamp(18px,4vw,48px)] py-6">
        {ready.length > 1 ? (
          <div className="flex flex-col gap-2">
            <p className="text-[13px] text-ink-700">Choose the therapy episode this session belongs to.</p>
            <div className="flex flex-wrap gap-2">
              {ready.map((e) => (
                <button key={e.id} type="button" className={`${BTN_GHOST} ${BTN_SM}`} onClick={() => setChosen(e.id)}>
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
          <Link to="/clinical/psychotherapy/group" className="font-semibold text-brand-green hover:underline">
            Group psychotherapy
          </Link>
          ; each attendee’s entry is listed on their record.
        </p>
      </div>
    </div>
  );
}
