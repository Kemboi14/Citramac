import { useEffect, useState, type ReactNode } from "react";
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
  initialSessionType = "INDIVIDUAL",
}: {
  patientId: string;
  initialEpisodeId?: string;
  onClose: () => void;
  /** The module's back link and header, shown until the session workspace
   * (which has its own) opens. */
  header?: ReactNode;
  /** Where the workspace's back crumb returns to. */
  backLabel?: string;
  /** Default session type for the session-details screen. */
  initialSessionType?: "INDIVIDUAL" | "FAMILY";
}) {
  const { accessToken } = useAuth();
  const { data, error } = useModule<TherapyState>(patientId, getTherapy);
  const ready = (data?.results ?? []).filter((e) => !e.ended && e.confidentiality_agreed);
  const [chosen, setChosen] = useState<string | null>(initialEpisodeId ?? null);
  const [launched, setLaunched] = useState(false);
  const [scheduleMode, setScheduleMode] = useState(false);
  const [panel, setPanel] = useState<"start" | "sessions">("start");
  const [noteSummaries, setNoteSummaries] = useState<PsyNoteSummary[] | null>(null);
  const [sessionsError, setSessionsError] = useState<string | null>(null);
  const [sessionRefresh, setSessionRefresh] = useState(0);
  const [selectedNoteId, setSelectedNoteId] = useState<string | null>(null);
  const [sessionType, setSessionType] = useState<"INDIVIDUAL" | "FAMILY">(initialSessionType);
  const [sessionObjective, setSessionObjective] = useState("");
  const [primaryGoal, setPrimaryGoal] = useState("");
  const episodeId = chosen ?? (ready.length === 1 ? ready[0].id : null);
  const familySessions = (noteSummaries ?? []).filter((note) => note.session_type === "FAMILY");

  useEffect(() => {
    if (!accessToken || panel !== "sessions") return;
    let active = true;
    listPsyNotes(accessToken, patientId)
      .then((response) => {
        if (active) setNoteSummaries(response.results);
      })
      .catch((e) => {
        if (active) setSessionsError(errorText(e, "Couldn't load family sessions."));
      });
    return () => {
      active = false;
    };
  }, [accessToken, panel, patientId, sessionRefresh]);

  const selectPanel = (next: "start" | "sessions") => {
    if (next === "sessions") {
      setNoteSummaries(null);
      setSessionsError(null);
    }
    setPanel(next);
  };

  const tabs = (
    <div
      role="tablist"
      aria-label="Client psychotherapy"
      className="inline-flex w-fit gap-1 rounded-lg bg-surface-bg p-1"
    >
      <button
        type="button"
        role="tab"
        aria-selected={panel === "start"}
        className={`rounded-md px-3 py-2 text-[13px] font-semibold transition-colors ${
          panel === "start"
            ? "bg-surface-card text-ink-900 shadow-sm"
            : "text-ink-500 hover:text-ink-900"
        }`}
        onClick={() => selectPanel("start")}
      >
        Start session
      </button>
      <button
        type="button"
        role="tab"
        aria-selected={panel === "sessions"}
        className={`rounded-md px-3 py-2 text-[13px] font-semibold transition-colors ${
          panel === "sessions"
            ? "bg-surface-card text-ink-900 shadow-sm"
            : "text-ink-500 hover:text-ink-900"
        }`}
        onClick={() => selectPanel("sessions")}
      >
        Sessions
      </button>
    </div>
  );
  const sessionList = (
    <div className="flex flex-col gap-3">
      <h3 className="text-sm font-bold text-ink-900">Family psychotherapy sessions</h3>
      <ErrorNote>{sessionsError}</ErrorNote>
      {!noteSummaries && !sessionsError && (
        <p className="text-xs text-ink-500">Loading sessions…</p>
      )}
      {noteSummaries && familySessions.length === 0 && (
        <p className="text-xs text-ink-500">No family psychotherapy sessions are recorded.</p>
      )}
      {familySessions.map((note) => (
        <div
          key={note.id}
          className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-surface-border p-3"
        >
          <div>
            <p className="text-[13px] font-semibold text-ink-900">
              {formatDateTime(note.session_date)} ·{" "}
              {note.status === "SIGNED" ? "Completed" : "In progress"}
            </p>
            <p className="text-xs text-ink-500">
              {note.restricted ? "Visible to the care team only" : note.author}
            </p>
          </div>
          <button
            type="button"
            className={`${BTN_GHOST} ${BTN_SM}`}
            disabled={note.restricted}
            onClick={() => setSelectedNoteId(note.id)}
          >
            Open session
          </button>
        </div>
      ))}
    </div>
  );

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
  if (selectedNoteId) {
    return (
      <PsychotherapyWorkspace
        inline
        patientId={patientId}
        noteId={selectedNoteId}
        sessionType="FAMILY"
        onClose={() => {
          setSelectedNoteId(null);
          setNoteSummaries(null);
          setSessionsError(null);
          setSessionRefresh((version) => version + 1);
        }}
        backLabel="Sessions"
      />
    );
  }
  if (episodeId && launched) {
    return (
      <PsychotherapyWorkspace
        inline
        patientId={patientId}
        episodeId={episodeId}
        sessionType={sessionType}
        sessionObjective={sessionObjective}
        primaryGoal={primaryGoal}
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
        <div className="flex w-full flex-col gap-5 p-4 sm:p-6">
          {tabs}
          {panel === "sessions" ? (
            sessionList
          ) : (
            <div className="flex flex-col gap-5">
              <header>
                {initialSessionType === "FAMILY" && (
                  <p className="text-[11px] font-bold uppercase tracking-[.1em] text-brand-green">
                    Family psychotherapy
                  </p>
                )}
                <h3 className="text-lg font-bold text-ink-900">
                  {initialSessionType === "FAMILY"
                    ? "Prepare session"
                    : "Prepare psychotherapy session"}
                </h3>
                <p className="mt-1 text-[13px] leading-5 text-ink-500">
                  {initialSessionType === "FAMILY"
                    ? "Set the focus for this session. The clinical note will be recorded only in this client’s record."
                    : "Set the focus for the session before opening the clinical note."}
                </p>
              </header>
              <div className="grid gap-4 lg:grid-cols-2">
                {initialSessionType === "FAMILY" ? (
                  <div className="flex items-center justify-between border-b border-surface-border pb-3 lg:col-span-2">
                    <span className="text-[13px] font-medium text-ink-700">Session type</span>
                    <span className="rounded-full bg-brand-green-tint px-3 py-1 text-xs font-semibold text-brand-green">
                      Family psychotherapy
                    </span>
                  </div>
                ) : (
                  <label className="block text-[13px] font-medium text-ink-700 lg:col-span-2">
                    Session type
                    <select
                      className={`${INPUT} mt-1.5`}
                      value={sessionType}
                      onChange={(e) => setSessionType(e.target.value as "INDIVIDUAL" | "FAMILY")}
                    >
                      <option value="INDIVIDUAL">Individual psychotherapy</option>
                      <option value="FAMILY">Family psychotherapy</option>
                    </select>
                  </label>
                )}
                {ep && (
                  <p className="text-xs text-ink-500 lg:col-span-2">
                    Therapy: {ep.modality}
                    {ep.activity_title ? ` · ${ep.activity_title}` : ""}
                  </p>
                )}
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
                    onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) =>
                      setPrimaryGoal(e.target.value)
                    }
                    placeholder="What goals are you working toward?"
                  />
                </label>
              </div>
              <div className="flex flex-wrap items-center gap-2 border-t border-surface-border pt-4">
                <button
                  type="button"
                  className={`${BTN} ${BTN_SM}`}
                  onClick={() => setLaunched(true)}
                >
                  {initialSessionType === "FAMILY" ? "Start family session" : "Start session"}
                </button>
                <button
                  type="button"
                  className={`${BTN_GHOST} ${BTN_SM}`}
                  onClick={() => setScheduleMode((v) => !v)}
                >
                  {scheduleMode
                    ? "Hide scheduling"
                    : initialSessionType === "FAMILY"
                      ? "Schedule family session"
                      : "Schedule instead"}
                </button>
                <button type="button" className={`${BTN_GHOST} ${BTN_SM}`} onClick={onClose}>
                  Cancel
                </button>
              </div>
              {scheduleMode && (
                <PsychotherapyPlanCard
                  key={sessionType}
                  patientId={patientId}
                  fixedAppointmentType={
                    sessionType === "FAMILY" ? "Family psychotherapy" : undefined
                  }
                />
              )}
            </div>
          )}
        </div>
      </>
    );
  }
  return (
    <>
      {header}
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="flex w-full flex-col gap-5 p-4 sm:p-6">
          {tabs}
          {panel === "sessions" ? (
            sessionList
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
