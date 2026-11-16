import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../../../../auth/useAuth";
import { getTherapy, type TherapyState } from "../../../../lib/carePathwayApi";
import { listPsyNotes, type PsyNoteSummary } from "../../../../lib/psychotherapyNoteApi";
import { errorText } from "../../triage/helpers";
import { BTN, BTN_GHOST, BTN_SM, INPUT } from "../../shared/styles";
import { ErrorNote } from "../../shared/ui";
import { PsychotherapyWorkspace } from "../modules/psychotherapy/Workspace";
import { PsychotherapyPlanCard } from "../modules/psychotherapy/NotePanel";
import { AutoResizeTextarea } from "../../shared/AutoResizeTextarea";
import { TherapyModule } from "../modules/TherapyModule";
import { useModule } from "../modules/useModule";
import { formatDateTime } from "../../shared/format";
import type { PsychotherapyKind } from "../../shared/recordRoutes";

const COPY: Record<
  PsychotherapyKind,
  { type: "INDIVIDUAL" | "FAMILY"; label: string; prepare: string; start: string }
> = {
  individual: {
    type: "INDIVIDUAL",
    label: "Individual psychotherapy",
    prepare: "Set the focus for the session before opening the clinical note.",
    start: "Start session",
  },
  family: {
    type: "FAMILY",
    label: "Family psychotherapy",
    prepare:
      "Set the focus for this session. The clinical note will be recorded only in this client’s record.",
    start: "Start family session",
  },
};

/** The session page body for one client (routed, client banner above it):
 * episode → prepare → the guided session note.
 *
 * A session note belongs to a therapy episode whose limits of confidentiality
 * are agreed, so until one exists the episode is set up here first. The session
 * type is fixed by the menu the page was opened from (`kind`) — an individual
 * session can't turn into a family one on the way. Signing the note records the
 * delivery; nothing is entered twice. */
export function PsychotherapyRecord({
  patientId,
  kind,
  initialEpisodeId,
  returnTo,
  onClose,
  backLabel,
}: {
  patientId: string;
  kind: PsychotherapyKind;
  initialEpisodeId?: string;
  /** Where the page's Back goes; passed on to session starts made here. */
  returnTo: string;
  onClose: () => void;
  /** Label of the workspace's back crumb. */
  backLabel: string;
}) {
  const copy = kind === "family" ? COPY.family : COPY.individual;
  const { accessToken } = useAuth();
  const { data, error } = useModule<TherapyState>(patientId, getTherapy);
  const ready = (data?.results ?? []).filter((e) => !e.ended && e.confidentiality_agreed);
  const [chosen, setChosen] = useState<string | null>(initialEpisodeId ?? null);
  const [launched, setLaunched] = useState(false);
  const [scheduleMode, setScheduleMode] = useState(false);
  const [panel, setPanel] = useState<"start" | "sessions">("start");
  const [notes, setNotes] = useState<PsyNoteSummary[] | null>(null);
  const [notesError, setNotesError] = useState<string | null>(null);
  const [notesVersion, setNotesVersion] = useState(0);
  const [openNoteId, setOpenNoteId] = useState<string | null>(null);
  const [sessionObjective, setSessionObjective] = useState("");
  const [primaryGoal, setPrimaryGoal] = useState("");
  const episodeId = chosen ?? (ready.length === 1 ? ready[0].id : null);
  const episode = ready.find((e) => e.id === episodeId);
  const sessions = (notes ?? []).filter((note) => note.session_type === copy.type);

  useEffect(() => {
    if (!accessToken || panel !== "sessions") return;
    let active = true;
    listPsyNotes(accessToken, patientId)
      .then((response) => {
        if (active) setNotes(response.results);
      })
      .catch((e) => {
        if (active) setNotesError(errorText(e, "Couldn't load the sessions."));
      });
    return () => {
      active = false;
    };
  }, [accessToken, panel, patientId, notesVersion]);

  if (error) return <ErrorNote>{error}</ErrorNote>;
  if (!data) return <p className="p-6 text-[13px] text-ink-500">Loading…</p>;

  if (openNoteId) {
    return (
      <PsychotherapyWorkspace
        inline
        patientId={patientId}
        noteId={openNoteId}
        backLabel="Sessions"
        onClose={() => {
          setOpenNoteId(null);
          setNotes(null);
          setNotesVersion((v) => v + 1);
        }}
      />
    );
  }
  if (episodeId && launched) {
    return (
      <PsychotherapyWorkspace
        inline
        patientId={patientId}
        episodeId={episodeId}
        sessionType={copy.type}
        sessionObjective={sessionObjective}
        primaryGoal={primaryGoal}
        onClose={onClose}
        backLabel={backLabel}
      />
    );
  }

  const tab = (value: "start" | "sessions", label: string) => (
    <button
      type="button"
      role="tab"
      aria-selected={panel === value}
      className={`rounded-md px-3 py-2 text-[13px] font-semibold transition-colors ${
        panel === value
          ? "bg-surface-card text-ink-900 shadow-sm"
          : "text-ink-500 hover:text-ink-900"
      }`}
      onClick={() => {
        if (value === "sessions") {
          setNotes(null);
          setNotesError(null);
        }
        setPanel(value);
      }}
    >
      {label}
    </button>
  );

  const sessionList = (
    <div className="flex flex-col gap-3">
      <ErrorNote>{notesError}</ErrorNote>
      {!notes && !notesError && <p className="text-xs text-ink-500">Loading sessions…</p>}
      {notes && sessions.length === 0 && (
        <p className="text-xs text-ink-500">
          No {copy.label.toLowerCase()} sessions are recorded for this client.
        </p>
      )}
      {sessions.map((note) => (
        <div
          key={note.id}
          className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-surface-border p-3"
        >
          <div>
            <p className="text-[13px] font-semibold text-ink-900">
              {formatDateTime(note.session_date)} · {note.status === "SIGNED" ? "Signed" : "Draft"}
            </p>
            <p className="text-xs text-ink-500">
              {note.restricted ? "Visible to the care team only" : note.author}
            </p>
          </div>
          <button
            type="button"
            className={`${BTN_GHOST} ${BTN_SM}`}
            disabled={note.restricted}
            onClick={() => setOpenNoteId(note.id)}
          >
            Open
          </button>
        </div>
      ))}
    </div>
  );

  const startPanel = episodeId ? (
    <div className="flex flex-col gap-5">
      <header>
        <h3 className="text-lg font-bold text-ink-900">Prepare session</h3>
        <p className="mt-1 text-[13px] leading-5 text-ink-500">{copy.prepare}</p>
        {episode && (
          <p className="mt-1 text-xs text-ink-500">
            Therapy: {episode.modality}
            {episode.activity_title ? ` · ${episode.activity_title}` : ""}
          </p>
        )}
      </header>
      <div className="grid gap-4 lg:grid-cols-2">
        <label className="block text-[13px] font-medium text-ink-700">
          Session objective
          <AutoResizeTextarea
            className={`${INPUT} mt-1.5 min-h-[112px]`}
            rows={3}
            value={sessionObjective}
            onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) =>
              setSessionObjective(e.target.value)
            }
            placeholder="What would you like this session to focus on?"
          />
        </label>
        <label className="block text-[13px] font-medium text-ink-700">
          Goals
          <AutoResizeTextarea
            className={`${INPUT} mt-1.5 min-h-[112px]`}
            rows={3}
            value={primaryGoal}
            onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setPrimaryGoal(e.target.value)}
            placeholder="What goals are you working toward?"
          />
        </label>
      </div>
      <div className="flex flex-wrap items-center gap-2 border-t border-surface-border pt-4">
        <button type="button" className={`${BTN} ${BTN_SM}`} onClick={() => setLaunched(true)}>
          {copy.start}
        </button>
        <button
          type="button"
          className={`${BTN_GHOST} ${BTN_SM}`}
          onClick={() => setScheduleMode((v) => !v)}
        >
          {scheduleMode ? "Hide scheduling" : "Schedule instead"}
        </button>
        {ready.length > 1 && (
          <button
            type="button"
            className={`${BTN_GHOST} ${BTN_SM}`}
            onClick={() => setChosen(null)}
          >
            Change therapy episode
          </button>
        )}
        <button type="button" className={`${BTN_GHOST} ${BTN_SM}`} onClick={onClose}>
          Cancel
        </button>
      </div>
      {scheduleMode && (
        <PsychotherapyPlanCard
          patientId={patientId}
          fixedAppointmentType={kind === "family" ? "Family psychotherapy" : undefined}
        />
      )}
    </div>
  ) : ready.length > 1 ? (
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
    // No episode with agreed confidentiality limits yet: set it up here. Its
    // start button reopens this page on the episode.
    <TherapyModule patientId={patientId} kinds={[kind]} returnTo={returnTo} />
  );

  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <div className="flex w-full flex-col gap-5 p-4 sm:p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-[11px] font-bold uppercase tracking-[.1em] text-brand-green">
            {copy.label}
          </p>
          <div
            role="tablist"
            aria-label={copy.label}
            className="inline-flex w-fit gap-1 rounded-lg bg-surface-bg p-1"
          >
            {tab("start", "New session")}
            {tab("sessions", "Sessions")}
          </div>
        </div>
        {panel === "sessions" ? sessionList : startPanel}
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
  );
}
