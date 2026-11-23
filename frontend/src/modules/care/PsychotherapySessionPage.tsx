import { useEffect, useState } from "react";
import { useAuth } from "../../auth/useAuth";
import { getPsyNote, type PsyNote } from "../../lib/psychotherapyNoteApi";
import { PsySessionSummary } from "./record/interventions/PsySessionSummary";
import { FileText } from "lucide-react";
import { Link, useLocation, useNavigate, useParams } from "react-router-dom";
import { PsychotherapyRecord } from "./record/interventions/PsychotherapyRecord";
import { PsychotherapyWorkspace } from "./record/modules/psychotherapy/Workspace";
import {
  clientRecordPath,
  psychotherapyListPath,
  psychotherapySessionPath,
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
  // The open session's number, for the breadcrumb (reported once the note loads).
  const [sessionNumber, setSessionNumber] = useState<number | null>(null);

  return (
    <div className="clinical-readable flex h-full min-h-0 flex-col gap-3 p-4 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Breadcrumbs
          items={[
            {
              label: backTo.startsWith("/clinical/clients/") ? "Client record" : "Psychotherapy",
              to: backTo,
            },
            // The client's name leads back to their sessions from an open session.
            noteId
              ? {
                  label: banner ? banner.name.trim() || "Temporary client (unnamed)" : "Client",
                  to: psychotherapySessionPath(kind, patientId),
                }
              : { label: banner ? banner.name.trim() || "Temporary client (unnamed)" : "Session" },
            ...(noteId ? [{ label: sessionNumber ? `Session ${sessionNumber}` : "Session" }] : []),
          ]}
        />
        <Link
          to={clientRecordPath(patientId, "interventions")}
          className={`${BTN_GHOST} ${BTN_SM}`}
        >
          <FileText aria-hidden className="h-4 w-4" />
          Full client record
        </Link>
      </div>
      <SafetyBanner banner={banner} error={error} />
      <div className="flex h-[calc(100vh-150px)] min-h-[460px] min-w-0 flex-col overflow-hidden rounded-xl border border-surface-border bg-surface-card">
        {noteId ? (
          <SavedNote
            key={noteId}
            patientId={patientId}
            noteId={noteId}
            backLabel="Sessions"
            onLoaded={setSessionNumber}
            onClose={() => navigate(psychotherapySessionPath(kind, patientId))}
          />
        ) : (
          <PsychotherapyRecord
            // A new episode in the URL (set up on this page) starts afresh.
            key={episodeId ?? "none"}
            patientId={patientId}
            kind={kind}
            initialEpisodeId={episodeId}
            backLabel={backLabel}
            onClose={close}
          />
        )}
      </div>
    </div>
  );
}

/** A saved note: a signed session opens as its summary (the full note one click
 * away); a draft opens in the workspace to be finished. */
function SavedNote({
  patientId,
  noteId,
  backLabel,
  onClose,
  onLoaded,
}: {
  patientId: string;
  noteId: string;
  backLabel: string;
  onClose: () => void;
  onLoaded: (sessionNumber: number | null) => void;
}) {
  const { accessToken } = useAuth();
  const [note, setNote] = useState<PsyNote | null>(null);
  const [full, setFull] = useState(false);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    if (!accessToken) return;
    let active = true;
    getPsyNote(accessToken, noteId)
      .then((loaded) => {
        if (!active) return;
        setNote(loaded as PsyNote);
        onLoaded((loaded as PsyNote).session_number ?? null);
      })
      // The workspace shows its own error for a note that cannot be opened.
      .catch(() => active && setFailed(true));
    return () => {
      active = false;
    };
  }, [accessToken, noteId, onLoaded]);
  if (!note && !failed) return <p className="p-6 text-[13px] text-ink-500">Opening the session…</p>;
  if (note && note.status === "SIGNED" && !full) {
    return (
      <div className="min-h-0 flex-1 overflow-y-auto p-4 sm:p-6">
        <PsySessionSummary
          noteId={noteId}
          initialNote={note}
          sessionNumber={note.session_number ?? 1}
          backLabel={backLabel}
          onBack={onClose}
          onOpenNote={() => setFull(true)}
        />
      </div>
    );
  }
  // A saved note keeps its own session type.
  return (
    <PsychotherapyWorkspace
      inline
      patientId={patientId}
      noteId={noteId}
      backLabel={backLabel}
      onClose={full ? () => setFull(false) : onClose}
    />
  );
}
