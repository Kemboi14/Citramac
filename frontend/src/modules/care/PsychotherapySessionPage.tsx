import { ArrowLeft, FileText } from "lucide-react";
import { Link, useLocation, useNavigate, useParams } from "react-router-dom";
import { PsychotherapyWorkspace } from "./record/modules/psychotherapy/Workspace";
import { clientRecordPath } from "./shared/recordRoutes";
import { SafetyBanner } from "./shared/SafetyBanner";
import { BTN_GHOST, BTN_SM } from "./shared/styles";
import { useClientBanner } from "./shared/useClientBanner";

// Individual Psychotherapy → Start session. A routed page inside the clinical
// shell (like the Psychiatry assessment workspace) instead of an overlay that
// covered the app: the client safety banner stays visible and the guided
// session fills the page. The draft itself still lives on the server (X-09),
// so leaving and returning resumes the same session.

const LIST_PATH = "/clinical/psychotherapy/individual";

export function PsychotherapySessionPage() {
  const { patientId = "", episodeId = "", noteId } = useParams();
  const { state } = useLocation();
  const navigate = useNavigate();
  const { banner, error } = useClientBanner(patientId || undefined);
  // Opened from the client record's Therapy tab → return there, not the list.
  const backTo = (state as { from?: string } | null)?.from ?? LIST_PATH;

  return (
    <div className="clinical-readable flex h-full min-h-0 flex-col gap-3 p-3 sm:p-5">
      <SafetyBanner banner={banner} error={error} />
      <div className="flex flex-wrap items-center gap-2">
        <Link to={backTo} className={`${BTN_GHOST} ${BTN_SM}`}>
          <ArrowLeft aria-hidden className="h-4 w-4" />
          Back
        </Link>
        <Link
          to={clientRecordPath(patientId, "interventions")}
          className={`${BTN_GHOST} ${BTN_SM}`}
        >
          <FileText aria-hidden className="h-4 w-4" />
          Full client record
        </Link>
      </div>
      <div className="flex min-h-[70vh] min-w-0 flex-1 flex-col overflow-hidden rounded-xl border border-surface-border bg-surface-card shadow-sm">
        <PsychotherapyWorkspace
          inline
          patientId={patientId}
          episodeId={episodeId || undefined}
          noteId={noteId}
          backLabel="Individual Psychotherapy"
          onClose={() => navigate(backTo)}
        />
      </div>
    </div>
  );
}
