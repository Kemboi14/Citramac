import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../../../auth/useAuth";
import { PanelSkeleton } from "../../../components/Skeleton";
import { ApiError } from "../../../lib/apiClient";
import { fieldErrorsFrom } from "../../../lib/formErrors";
import {
  confirmGroupSession,
  screenGroupEntries,
  type RiskFlag,
  getGroupSession,
  getGroupUtilisation,
  getGroupWorkspace,
  type AttendanceCode,
  type GroupSessionDetail,
  type GroupUtilisation,
  type GroupWorkspace,
} from "../../../lib/groupProgrammeApi";
import { newRequestId } from "../shared/format";
import { clientRecordPath } from "../shared/recordRoutes";
import { Callout } from "../shared/ui";
import { useValueSets } from "../shared/useValueSets";
import { CategoryConfig } from "./CategoryConfig";
import { EntryCorrectionDialog, SessionCorrectionDialog } from "./CorrectionDialogs";
import {
  detailsErrors,
  detailsPayload,
  formFieldErrors,
  initialDetails,
  itemTab,
  localDateIso,
  matchesFilters,
  scheduledLocal,
  workspaceItems,
  type DraftAttendance,
  type Filters,
  type ProgrammeView,
  type SessionDraft,
  type SessionForm,
  type SessionTab,
  type WorkspaceItem,
} from "./model";
import { ReviewPanel } from "./ReviewPanel";
import { SessionEditor } from "./SessionEditor";
import { SessionHistory } from "./SessionHistory";
import { SessionRail } from "./SessionRail";
import { SessionWorkspace } from "./SessionWorkspace";
import { UtilisationView } from "./UtilisationView";

const ATTENDANCE_VALUESET = "group-attendance";

type Dialog = { kind: "session" | "entry"; detail: GroupSessionDetail } | null;

function uniqueSorted(values: string[]) {
  return [...new Set(values)].sort();
}

/**
 * Group Psychotherapy — the v4 mockup's `groupProgrammePage`. One shared session
 * (FHIR Appointment + Group), one separate entry per client (FHIR Encounter), each
 * linked to that client's own Group Psychotherapy intervention record. Attendance
 * being marked lives in React state only until the reviewed session is confirmed
 * (CLAUDE.md §5); the server does the saving, linking and per-client separation.
 */
export function GroupProgrammePage() {
  const { accessToken, claims } = useAuth();
  const navigate = useNavigate();
  const valueSets = useValueSets();
  const attendanceOptions = valueSets.options(ATTENDANCE_VALUESET);
  const attendanceLabel = (code: string) => valueSets.label(ATTENDANCE_VALUESET, code);

  const [workspace, setWorkspace] = useState<GroupWorkspace | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [view, setView] = useState<ProgrammeView>("session");
  const [tab, setTab] = useState<SessionTab>("today");
  const draftStarted = useRef(false);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [draftKey, setDraftKey] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, SessionDraft>>({});
  const requestIds = useRef<Record<string, string>>({});
  const [filters, setFilters] = useState<Filters>({
    programme: "",
    unit: "",
    eligibility: "eligible",
  });
  const [search, setSearch] = useState("");
  const [observationOpen, setObservationOpen] = useState<Record<string, boolean>>({});
  const [detail, setDetail] = useState<GroupSessionDetail | null>(null);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [editorOpen, setEditorOpen] = useState(false);
  const [reviewKey, setReviewKey] = useState<string | null>(null);
  // Server risk screen of each observation, run at review (nothing stored).
  const [riskFlags, setRiskFlags] = useState<Record<string, RiskFlag[]>>({});
  const [editorErrors, setEditorErrors] = useState<Record<string, string>>({});
  const [editorStatus, setEditorStatus] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [statusMessage, setStatusMessage] = useState("");
  const [utilisation, setUtilisation] = useState<GroupUtilisation | null>(null);
  const [utilisationError, setUtilisationError] = useState<string | null>(null);
  const [dialog, setDialog] = useState<Dialog>(null);

  const loadWorkspace = useCallback(() => {
    if (!accessToken) return Promise.resolve();
    return getGroupWorkspace(accessToken)
      .then((data) => {
        setWorkspace(data);
        setLoadError(null);
        // First load only: start a draft when nothing is on today (mockup behaviour).
        if (draftStarted.current) return;
        draftStarted.current = true;
        const today = localDateIso();
        const hasToday =
          data.scheduled.some((s) => scheduledLocal(s).date === today) ||
          data.sessions.some((s) => s.session_date === today);
        if (!hasToday) {
          const key = `draft:${Date.now()}`;
          setDraftKey(key);
          setSelectedKey(key);
        }
      })
      .catch((err) =>
        setLoadError(
          err instanceof ApiError ? err.message : "The group programme could not be loaded.",
        ),
      );
  }, [accessToken]);

  useEffect(() => {
    void loadWorkspace();
  }, [loadWorkspace]);

  const items = useMemo(
    () =>
      workspace ? workspaceItems(workspace.sessions, workspace.scheduled, draftKey, drafts) : [],
    [workspace, draftKey, drafts],
  );

  const visibleItems = items.filter((item) => item.tab === tab);
  const selected: WorkspaceItem | undefined =
    visibleItems.find((item) => item.key === selectedKey) ?? visibleItems[0];
  const selectedSessionId = selected?.kind === "saved" ? selected.session?.id : undefined;

  useEffect(() => {
    if (!accessToken || !selectedSessionId) return;
    let cancelled = false;
    getGroupSession(accessToken, selectedSessionId)
      .then((data) => {
        if (cancelled) return;
        setDetail(data);
        setDetailError(null);
      })
      .catch(
        (err) =>
          !cancelled &&
          setDetailError(
            err instanceof ApiError ? err.message : "The session entries could not be loaded.",
          ),
      );
    return () => {
      cancelled = true;
    };
  }, [accessToken, selectedSessionId]);

  useEffect(() => {
    if (view !== "utilisation" || !accessToken) return;
    getGroupUtilisation(accessToken)
      .then((data) => {
        setUtilisation(data);
        setUtilisationError(null);
      })
      .catch((err) =>
        setUtilisationError(
          err instanceof ApiError ? err.message : "Programme utilisation could not be loaded.",
        ),
      );
  }, [view, accessToken]);

  // Unconfirmed attendance lives only in this tab: warn before it is lost.
  const hasUnsavedAttendance = Object.values(drafts).some(
    (draft) => Object.keys(draft.attendance).length > 0,
  );
  useEffect(() => {
    if (!hasUnsavedAttendance) return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [hasUnsavedAttendance]);

  if (!workspace) {
    return loadError ? (
      <div className="p-5">
        <Callout tone="danger" role="alert">
          {loadError}
        </Callout>
      </div>
    ) : (
      <div className="p-5">
        <PanelSkeleton />
      </div>
    );
  }

  const { categories, clients, staff, current_user: currentUser } = workspace;
  const programmes = uniqueSorted(clients.map((c) => c.programme));
  const units = uniqueSorted(clients.map((c) => c.unit));
  const editable = selected && selected.kind !== "saved" ? selected : undefined;
  const draftFor = (item: WorkspaceItem): SessionDraft =>
    drafts[item.key] ?? {
      details: initialDetails(item, categories, currentUser, staff),
      attendance: {},
    };
  const currentDraft = editable ? draftFor(editable) : undefined;

  const updateDraft = (item: WorkspaceItem, change: (draft: SessionDraft) => SessionDraft) =>
    setDrafts((prev) => ({
      ...prev,
      [item.key]: change(
        prev[item.key] ?? {
          details: initialDetails(item, categories, currentUser, staff),
          attendance: {},
        },
      ),
    }));

  const changeAttendance = (clientId: string, updates: DraftAttendance) => {
    if (!editable) return;
    setReviewKey(null);
    updateDraft(editable, (draft) => ({
      ...draft,
      attendance: {
        ...draft.attendance,
        // eslint-disable-next-line security/detect-object-injection -- client id from the served list.
        [clientId]: { ...draft.attendance[clientId], ...updates },
      },
    }));
  };

  /** A change made in the review panel itself — keeps the review open. */
  const changeAtReview = (clientId: string, updates: DraftAttendance) => {
    if (!editable) return;
    updateDraft(editable, (draft) => ({
      ...draft,
      attendance: {
        ...draft.attendance,
        // eslint-disable-next-line security/detect-object-injection -- client id from the served list.
        [clientId]: { ...draft.attendance[clientId], ...updates },
      },
    }));
  };

  const changeDetails = (updates: Partial<SessionForm>) => {
    if (!editable) return;
    setReviewKey(null);
    updateDraft(editable, (draft) => ({ ...draft, details: { ...draft.details, ...updates } }));
  };

  const select = (key: string) => {
    setSelectedKey(key);
    setSearch("");
    setView("session");
    setReviewKey(null);
    setEditorErrors({});
    setEditorStatus("");
    if (key !== selected?.key) setDetailError(null);
  };

  // Two frames: the target (editor open, review panel) renders after this state update.
  const scrollToId = (id: string) =>
    requestAnimationFrame(() =>
      requestAnimationFrame(() =>
        document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" }),
      ),
    );
  const scrollToEditor = () => scrollToId("group-session-editor");
  // The page scrolls in #main-content on wide screens and in the window on narrow ones.
  const scrollToTop = () =>
    requestAnimationFrame(() => {
      document.getElementById("main-content")?.scrollTo({ top: 0, behavior: "smooth" });
      window.scrollTo({ top: 0, behavior: "smooth" });
    });

  const startNewSession = () => {
    const key = draftKey ?? `draft:${Date.now()}`;
    setDraftKey(key);
    select(key);
    setTab("today");
    setStatusMessage("");
    setEditorOpen(true);
    scrollToEditor();
  };

  const chooseScheduled = (key: string) => {
    if (!key) return startNewSession();
    const item = items.find((i) => i.key === key);
    if (!item) return;
    select(key);
    setTab(item.tab);
  };

  const selectableRows = (draft: SessionDraft) =>
    clients
      .filter((client) => matchesFilters(client, filters) && client.eligible)
      .map((client) => ({ client, entry: draft.attendance[client.id] ?? {} }));

  const review = () => {
    if (!editable || !currentDraft) return;
    setEditorOpen(true);
    setStatusMessage("");
    const rows = selectableRows(currentDraft);
    const errors = detailsErrors(currentDraft.details, categories);
    setEditorErrors(errors);
    let problem = "";
    if (!rows.length) problem = "No eligible clients match the selected filters.";
    else if (rows.some((row) => !row.entry.attendance)) {
      problem = "Select an attendance status for every listed client.";
    } else if (rows.some((row) => row.entry.riskDisclosure && !row.entry.observation?.trim())) {
      problem = "Record an observation for every client with a risk disclosure.";
    } else if (Object.keys(errors).length) {
      problem = "Complete the session details before reviewing the session.";
    }
    setEditorStatus(problem);
    if (problem || !accessToken) {
      setReviewKey(null);
      scrollToEditor();
      return;
    }
    // Owner decision 2026-10-22: risk language in an observation is flagged
    // automatically — pre-ticked as a disclosure with a follow-up; unticking
    // it needs a reason (the server enforces the same rule on confirm).
    const key = editable.key;
    setEditorStatus("Checking observations for risk language…");
    screenGroupEntries(
      accessToken,
      rows.map(({ client, entry }) => ({ patient: client.id, observation: entry.observation ?? "" })),
    )
      .then(({ results }) => {
        const flags: Record<string, RiskFlag[]> = {};
        for (const row of results) {
          if (row.flags.length) flags[row.patient] = row.flags;
        }
        setRiskFlags(flags);
        setEditorStatus("");
        for (const { client, entry } of rows) {
          if (client.id in flags && !entry.riskDisclosure && !entry.riskOverrideReason) {
            changeAtReview(client.id, { riskDisclosure: true, followUp: true });
          }
        }
        setReviewKey(key);
        scrollToId("group-session-review");
      })
      .catch((err) =>
        setEditorStatus(err instanceof ApiError ? err.message : "Couldn't screen the observations for risk language."),
      );
  };

  const confirm = () => {
    if (!accessToken || !editable || !currentDraft) return;
    const requestId = (requestIds.current[editable.key] ??= newRequestId());
    setConfirming(true);
    setEditorStatus("");
    confirmGroupSession(accessToken, {
      ...detailsPayload(currentDraft.details, categories),
      client_request_id: requestId,
      appointment: editable.scheduled?.appointment_id ?? null,
      entries: selectableRows(currentDraft).map(({ client, entry }) => ({
        patient: client.id,
        attendance: entry.attendance as AttendanceCode,
        observation: entry.observation?.trim() ?? "",
        risk_disclosure: Boolean(entry.riskDisclosure),
        follow_up: Boolean(entry.followUp || entry.riskDisclosure),
        risk_override_reason: entry.riskDisclosure ? "" : (entry.riskOverrideReason?.trim() ?? ""),
      })),
    })
      .then((saved) => {
        const doneKey = editable.key;
        setDrafts((prev) => {
          const next = { ...prev };
          // eslint-disable-next-line security/detect-object-injection -- key from state.
          delete next[doneKey];
          return next;
        });
        if (doneKey === draftKey) setDraftKey(null);
        setReviewKey(null);
        setEditorOpen(false);
        setSelectedKey(`session:${saved.id}`);
        setTab(itemTab(saved.session_date));
        setView("session");
        setDetail(saved);
        setStatusMessage(
          "Session confirmed. Attendance and client-specific observations are linked to the Group Psychotherapy intervention history.",
        );
        scrollToTop();
        return loadWorkspace();
      })
      .catch((err) => {
        setEditorErrors(formFieldErrors(fieldErrorsFrom(err)));
        setEditorStatus(
          err instanceof ApiError
            ? err.message
            : "The group session could not be saved. No confirmation was recorded.",
        );
      })
      .finally(() => setConfirming(false));
  };

  const openDialog = (kind: "session" | "entry", sessionId: string) => {
    if (!accessToken) return;
    if (detail?.id === sessionId) return setDialog({ kind, detail });
    getGroupSession(accessToken, sessionId)
      .then((loaded) => setDialog({ kind, detail: loaded }))
      .catch((err) =>
        setStatusMessage(
          err instanceof ApiError ? err.message : "The session could not be opened.",
        ),
      );
  };

  const corrected = (message: string) => (saved: GroupSessionDetail) => {
    setDialog(null);
    if (saved.id === detail?.id) setDetail(saved);
    setStatusMessage(message);
    void loadWorkspace();
  };

  const reviewRows = currentDraft ? selectableRows(currentDraft) : [];
  const reviewDetails = currentDraft?.details;
  const facilitatorName = (form: SessionForm) =>
    staff.find((s) => s.id === form.facilitatorId)?.name ?? form.facilitatorName;

  return (
    <div className="flex min-h-full flex-col">
      <div className="flex flex-col bg-surface-bg lg:h-[calc(100vh-56px)]">
        <header className="flex min-h-14 flex-wrap items-center justify-between gap-3 border-b border-surface-border bg-surface-card px-4 py-[9px] sm:px-6">
          <div
            className="flex gap-1 rounded-[10px] bg-surface-bg p-[3px]"
            role="tablist"
            aria-label="Programme views"
          >
            {(
              [
                ["session", "Session"],
                ["utilisation", "Utilisation"],
              ] as [ProgrammeView, string][]
            ).map(([key, label]) => (
              <button
                key={key}
                type="button"
                role="tab"
                aria-selected={view === key}
                onClick={() => setView(key)}
                className={`rounded-lg px-3.5 py-[7px] text-xs font-bold ${
                  view === key ? "bg-surface-card text-ink-900 shadow-sm" : "text-ink-500"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
          <div className="text-[11px] text-ink-500 sm:text-right">
            Signed in: <strong className="text-ink-900">{currentUser.name}</strong> ·{" "}
            {claims?.role.replace(/_/g, " ") || "Staff"}
          </div>
        </header>
        {(loadError || valueSets.error) && (
          <Callout tone="danger" role="alert" className="mx-5 mt-2.5">
            {loadError || valueSets.error}
          </Callout>
        )}
        {statusMessage && (
          <Callout role="status" className="mx-5 mt-2.5">
            {statusMessage}
          </Callout>
        )}
        <section
          className="grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-[minmax(275px,320px)_minmax(0,1fr)]"
          aria-label="Group psychotherapy session workspace"
        >
          <SessionRail
            items={visibleItems}
            tab={tab}
            selectedKey={selected?.key ?? null}
            onTab={(next) => {
              setTab(next);
              setView("session");
            }}
            onSelect={select}
            onNewSession={startNewSession}
          />
          <section
            // Below lg the workspace is a fixed 540px pane that scrolls inside
            // (mockup), so the session rail above it stays in view.
            className="flex min-w-0 flex-col overflow-hidden bg-surface-card max-lg:h-[540px] lg:min-h-0"
            aria-live="polite"
          >
            {view === "utilisation" ? (
              <UtilisationView data={utilisation} error={utilisationError} />
            ) : selected ? (
              <SessionWorkspace
                item={selected}
                documentedBy={currentUser.name}
                attendanceOptions={attendanceOptions}
                attendanceLabel={attendanceLabel}
                clients={clients}
                programmes={programmes}
                units={units}
                filters={filters}
                onFilters={setFilters}
                search={search}
                onSearch={setSearch}
                draft={currentDraft}
                onDraftChange={changeAttendance}
                observationOpen={Object.fromEntries(
                  clients.map((c) => [c.id, Boolean(observationOpen[`${selected.key}:${c.id}`])]),
                )}
                onToggleObservation={(clientId) =>
                  setObservationOpen((prev) => ({
                    ...prev,
                    [`${selected.key}:${clientId}`]: !prev[`${selected.key}:${clientId}`],
                  }))
                }
                detail={
                  selected.kind === "saved" && detail?.id === selectedSessionId ? detail : null
                }
                detailError={selected.kind === "saved" ? detailError : null}
                onReview={review}
                onEditScheduled={() => {
                  setEditorOpen(true);
                  scrollToEditor();
                }}
                onEditDetails={() => selectedSessionId && openDialog("session", selectedSessionId)}
                onCorrectEntry={() => selectedSessionId && openDialog("entry", selectedSessionId)}
                onOpenInterventions={(patientId) =>
                  navigate(clientRecordPath(patientId, "interventions"))
                }
              />
            ) : (
              <div className="min-h-0 flex-1 overflow-auto px-8 py-6">
                <div className="p-6 text-center text-xs text-ink-500">
                  No sessions here. Create a group session or choose another session period.
                </div>
              </div>
            )}
          </section>
        </section>
      </div>

      <div className="grid min-w-0 gap-4 p-4 sm:p-5 [&>*]:min-w-0">
        <SessionEditor
          open={editorOpen}
          onToggle={setEditorOpen}
          editable={Boolean(editable)}
          scheduled={workspace.scheduled}
          scheduledKey={editable?.kind === "scheduled" ? editable.key : ""}
          onSelectScheduled={chooseScheduled}
          form={currentDraft?.details ?? null}
          errors={editorErrors}
          onFormChange={changeDetails}
          categories={categories}
          staff={staff}
          documentedBy={currentUser.name}
          clients={clients}
          programmes={programmes}
          units={units}
          filters={filters}
          onFilters={setFilters}
          attendance={currentDraft?.attendance ?? {}}
          attendanceOptions={attendanceOptions}
          onDraftChange={changeAttendance}
          onReview={review}
          status={editorStatus}
          review={
            editable && reviewKey === editable.key && reviewDetails ? (
              <ReviewPanel
                summary={{
                  category: categories.find((c) => c.code === reviewDetails.category)?.is_other
                    ? reviewDetails.categoryOther.trim()
                    : (categories.find((c) => c.code === reviewDetails.category)?.display ?? ""),
                  topic: reviewDetails.topic.trim(),
                  sessionDate: reviewDetails.sessionDate,
                  startTime: reviewDetails.startTime,
                  endTime: reviewDetails.endTime,
                  location: reviewDetails.location.trim(),
                  facilitator: facilitatorName(reviewDetails),
                  documentedBy: currentUser.name,
                }}
                rows={reviewRows}
                riskFlags={riskFlags}
                onEntryChange={changeAtReview}
                attendanceLabel={attendanceLabel}
                confirming={confirming}
                onConfirm={confirm}
                onReturn={() => setReviewKey(null)}
              />
            ) : null
          }
        />
        <CategoryConfig
          categories={categories}
          canConfigure={workspace.can_configure}
          onChanged={(payload) =>
            setWorkspace((prev) =>
              prev
                ? { ...prev, categories: payload.results, can_configure: payload.can_configure }
                : prev,
            )
          }
        />
        <SessionHistory
          sessions={workspace.sessions}
          onCorrectDetails={(id) => openDialog("session", id)}
          onCorrectEntry={(id) => openDialog("entry", id)}
        />
      </div>

      {dialog?.kind === "session" && (
        <SessionCorrectionDialog
          session={dialog.detail}
          categories={categories}
          staff={staff}
          onClose={() => setDialog(null)}
          onSaved={corrected(
            "Session correction saved and linked intervention details synchronized.",
          )}
        />
      )}
      {dialog?.kind === "entry" && (
        <EntryCorrectionDialog
          session={dialog.detail}
          attendanceOptions={attendanceOptions}
          onClose={() => setDialog(null)}
          onSaved={corrected(
            "Client entry correction saved and linked intervention history synchronized.",
          )}
        />
      )}
    </div>
  );
}
