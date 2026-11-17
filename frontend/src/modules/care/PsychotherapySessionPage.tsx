import { FileText } from "lucide-react";
import { Link, useLocation, useNavigate, useParams } from "react-router-dom";
import { PsychotherapyRecord } from "./record/interventions/PsychotherapyRecord";
import { PsychotherapyWorkspace } from "./record/modules/psychotherapy/Workspace";
import {
  clientRecordPath,
  psychotherapyListPath,
  type PsychotherapyKind,
} from "./shared/recordRoutes";
import { SafetyBanner } from "./shared/SafetyBanner";
import { BTN_GHOST, BTN_SM } from "./shared/styles";
import { useClientBanner } from "./shared/useClientBanner";
import { Breadcrumbs } from "./shared/Breadcrumbs";

// The one place a psychotherapy session is written: a routed page inside the
// clinical shell, so the client safety banner stays visible. Opened from the
// Individual / Family Psychotherapy lists and from the client record's
// Interventions › Psychotherapy launcher. The draft lives on the server (X-09),
// so leaving and returning resumes the same session.

export function PsychotherapySessionPage({ kind = "individual" }: { kind?: PsychotherapyKind }) {
  const backLabel = kind === "family" ? "Family Psychotherapy" : "Individual Psychotherapy";
  const { patientId = "", episodeId, noteId } = useParams();
  const { state } = useLocation();
  const navigate = useNavigate();
  const { banner, error } = useClientBanner(patientId || undefined);
  // Opened from the client record → return there, not the list.
  const backTo = (state as { from?: string } | null)?.from ?? psychotherapyListPath(kind);
  const close = () => navigate(backTo);

  return (
    <div className="clinical-readable flex h-full min-h-0 flex-col gap-3 p-3 sm:p-5">
      <Breadcrumbs
        items={[
          {
            label: backTo.startsWith("/clinical/clients/") ? "Client record" : "Psychotherapy",
            to: backTo,
          },
          { label: banner ? banner.name.trim() || "Temporary client (unnamed)" : "Session" },
        ]}
      />
      <SafetyBanner banner={banner} error={error} />
      <div className="flex flex-wrap items-center gap-2">
        <Link
          to={clientRecordPath(patientId, "interventions")}
          className={`${BTN_GHOST} ${BTN_SM}`}
        >
          <FileText aria-hidden className="h-4 w-4" />
          Full client record
        </Link>
      </div>
      <div className="flex min-h-[70vh] min-w-0 flex-1 flex-col overflow-hidden rounded-xl border border-surface-border bg-surface-card shadow-sm">
        {noteId ? (
          // A saved note keeps its own session type.
          <PsychotherapyWorkspace
            inline
            patientId={patientId}
            noteId={noteId}
            backLabel={backLabel}
            onClose={close}
          />
        ) : (
          <PsychotherapyRecord
            // A new episode in the URL (set up on this page) starts afresh.
            key={episodeId ?? "none"}
            patientId={patientId}
            kind={kind}
            initialEpisodeId={episodeId}
            returnTo={backTo}
            backLabel={backLabel}
            onClose={close}
          />
        )}
      </div>
    </div>
  );
}
