import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../../../../auth/useAuth";
import {
  agreeConfidentiality,
  getTherapy,
  setPlannedSessions,
  startTherapy,
  type TherapyState,
} from "../../../../lib/carePathwayApi";
import { listPsyNotes, type PsyNoteSummary } from "../../../../lib/psychotherapyNoteApi";
import { errorText } from "../../triage/helpers";
import { BTN, BTN_GHOST, BTN_SM, INPUT } from "../../shared/styles";
import { ErrorNote } from "../../shared/ui";
import { PsychotherapyWorkspace } from "../modules/psychotherapy/Workspace";
import { PsychotherapyPlanCard } from "../modules/psychotherapy/NotePanel";
import { AutoResizeTextarea } from "../../shared/AutoResizeTextarea";
import { useModule } from "../modules/useModule";
import { useValueSets } from "../../shared/useValueSets";
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
  onClose,
  backLabel,
}: {
  patientId: string;
  kind: PsychotherapyKind;
  initialEpisodeId?: string;
  onClose: () => void;
  /** Label of the workspace's back crumb. */
  backLabel: string;
}) {
  const copy = kind === "family" ? COPY.family : COPY.individual;
  const { accessToken } = useAuth();
  const { data, error, act } = useModule<TherapyState>(patientId, getTherapy);
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
  // First session only: the course of therapy is set up here, in two answers.
  // The approach is a coded, required field and no note may be written until
  // the limits of confidentiality are agreed — both stay, nothing else is asked.
  const vs = useValueSets();
  const pending = (data?.results ?? []).find((e) => !e.ended && !e.confidentiality_agreed);
  const needsSetup = !episodeId && ready.length === 0;
  const [approach, setApproach] = useState(kind === "family" ? "FAMILY" : "");
  const [agreed, setAgreed] = useState(false);
  const [planned, setPlanned] = useState("");
  const [setupBusy, setSetupBusy] = useState(false);
  const [setupError, setSetupError] = useState<string | null>(null);
  const canBegin = !needsSetup || (agreed && (Boolean(pending) || Boolean(approach)));
  const begin = async () => {
    if (!needsSetup) return setLaunched(true);
    if (!accessToken || !canBegin) return;
    setSetupBusy(true);
    setSetupError(null);
    try {
      const id =
        pending?.id ??
        (
          (await startTherapy(accessToken, patientId, {
            modality: approach,
            planned_sessions: planned ? Number(planned) : null,
          })) as { id: string }
        ).id;
      await agreeConfidentiality(accessToken, id);
      setChosen(id);
      setLaunched(true);
    } catch (e) {
      setSetupError(errorText(e, "Couldn't start the course of therapy."));
    } finally {
      setSetupBusy(false);
    }
  };
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

  const startPanel =
    episodeId || needsSetup ? (
      <div className="flex flex-col gap-5">
        <header>
          <h3 className="text-lg font-bold text-ink-900">Prepare session</h3>
          <p className="mt-1 text-[13px] leading-5 text-ink-500">{copy.prepare}</p>
        </header>
        {episode && (
          <SessionsPlanned
            key={`${episode.id}-${episode.planned_sessions ?? ""}`}
            recorded={episode.sessions.length}
            planned={episode.planned_sessions}
            onSave={(value) => void act((t) => setPlannedSessions(t, episode.id, value))}
          />
        )}
        {needsSetup && (
          <section className="rounded-lg border border-surface-border bg-surface-bg p-4">
            <h4 className="text-[13px] font-semibold text-ink-900">
              First session with this client
            </h4>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              {!pending && (
                <label className="block text-[13px] font-medium text-ink-700">
                  Therapy approach *
                  <select
                    className={`${INPUT} mt-1.5`}
                    value={approach}
                    onChange={(e) => setApproach(e.target.value)}
                  >
                    <option value="">Choose…</option>
                    {vs.options("therapy-modality").map((o) => (
                      <option key={o.code} value={o.code}>
                        {o.display}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              {!pending && (
                <label className="block text-[13px] font-medium text-ink-700">
                  Number of sessions
                  <input
                    className={`${INPUT} mt-1.5`}
                    type="number"
                    min={1}
                    max={100}
                    placeholder="e.g. 8 (optional)"
                    value={planned}
                    onChange={(e) => setPlanned(e.target.value)}
                  />
                </label>
              )}
              <label className="flex items-start gap-2 self-end text-[13px] text-ink-900 sm:col-span-2">
                <input
                  type="checkbox"
                  className="mt-0.5"
                  checked={agreed}
                  onChange={(e) => setAgreed(e.target.checked)}
                />
                <span>
                  I have explained the limits of confidentiality and the client agrees: what stays
                  private, what is shared with the care team, and when safety would mean sharing
                  more.
                </span>
              </label>
            </div>
            <ErrorNote>{setupError}</ErrorNote>
          </section>
        )}
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
            disabled={!canBegin || setupBusy}
            onClick={() => void begin()}
          >
            {setupBusy ? "Starting…" : copy.start}
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
    ) : (
      // More than one course of therapy is open: choose which this session belongs to.
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

/** How many sessions this course of therapy plans, and how far along it is. */
function SessionsPlanned({
  recorded,
  planned,
  onSave,
}: {
  recorded: number;
  planned: number | null;
  onSave: (value: number | null) => void;
}) {
  const [value, setValue] = useState(planned ? String(planned) : "");
  const next = value ? Number(value) : null;
  const valid = next === null || (Number.isInteger(next) && next >= 1 && next <= 100);
  const changed = next !== planned;
  return (
    <div className="flex flex-wrap items-end gap-3 rounded-lg border border-surface-border px-4 py-3">
      <label className="block text-[13px] font-medium text-ink-700">
        Number of sessions
        <input
          className={`${INPUT} mt-1.5 w-28`}
          type="number"
          min={1}
          max={100}
          placeholder="Not set"
          value={value}
          onChange={(e) => setValue(e.target.value)}
        />
      </label>
      <button
        type="button"
        className={`${BTN_GHOST} ${BTN_SM}`}
        disabled={!changed || !valid}
        onClick={() => onSave(next)}
      >
        Save
      </button>
      <p className="pb-1.5 text-xs text-ink-500">
        {recorded} recorded{planned ? ` of ${planned} planned` : ""} · this session is{" "}
        {recorded + 1}
        {planned ? ` of ${planned}` : ""}
      </p>
    </div>
  );
}
