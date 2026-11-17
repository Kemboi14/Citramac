import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../../../auth/useAuth";
import { INPUT } from "../shared/styles";
import { Card, Field } from "../shared/ui";
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
import { BTN } from "../shared/styles";
import { Callout, PageHeader } from "../shared/ui";
import { useValueSets } from "../shared/useValueSets";
import { CategoryConfig, ProgrammeConfig } from "./CategoryConfig";
import { EntryCorrectionDialog, SessionCorrectionDialog } from "./CorrectionDialogs";
import {
  detailsErrors,
  detailsPayload,
  formFieldErrors,
  initialDetails,
  itemTab,
  eligibleFor,
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
import { SessionDetailsFields } from "./SessionDetailsFields";
import { SessionRail } from "./SessionRail";
import { SessionWorkspace } from "./SessionWorkspace";
import { UtilisationView } from "./UtilisationView";

const ATTENDANCE_VALUESET = "group-attendance";

type Step = "details" | "attendance" | "review";
type PageView = ProgrammeView | "settings";

const STEPS: [Step, string][] = [
  ["details", "Session details"],
  ["attendance", "Attendance"],
  ["review", "Review & confirm"],
];

type Dialog = { kind: "session" | "entry"; detail: GroupSessionDetail } | null;

function uniqueSorted(values: string[]) {
  return [...new Set(values)].sort();
}

/**
 * Group Psychotherapy — the v4 mockup's `groupProgrammePage`. One shared session
 * (FHIR Appointment + Group), one separate entry per client (FHIR Encounter), each
 * linked to that client's own Group Psychotherapy intervention record. Attendance
 * being marked lives in React state only until the reviewed session is confirmed
 * (guide.md §5); the server does the saving, linking and per-client separation.
 */
export function GroupProgrammePage() {
  const { accessToken } = useAuth();
  const navigate = useNavigate();
  const valueSets = useValueSets();
  const attendanceOptions = valueSets.options(ATTENDANCE_VALUESET);
  const attendanceLabel = (code: string) => valueSets.label(ATTENDANCE_VALUESET, code);

  const [workspace, setWorkspace] = useState<GroupWorkspace | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [view, setView] = useState<PageView>("session");
  const [tab, setTab] = useState<SessionTab>("today");
  const [step, setStep] = useState<Step>("details");
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [draftKey, setDraftKey] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, SessionDraft>>({});
  const requestIds = useRef<Record<string, string>>({});
  const [filters, setFilters] = useState<Filters>({
    programme: "",
    unit: "",
    eligibility: "eligible",
    outpatients: false,
  });
  const [search, setSearch] = useState("");
  const [observationOpen, setObservationOpen] = useState<Record<string, boolean>>({});
  const [detail, setDetail] = useState<GroupSessionDetail | null>(null);
  const [detailError, setDetailError] = useState<string | null>(null);

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

  const { categories, staff, current_user: currentUser } = workspace;
  const programmes = uniqueSorted(workspace.clients.map((c) => c.programme));
  const units = uniqueSorted(workspace.clients.map((c) => c.unit));
  const editable = selected && selected.kind !== "saved" ? selected : undefined;
  const draftFor = (item: WorkspaceItem): SessionDraft =>
    drafts[item.key] ?? {
      details: initialDetails(item, categories, currentUser, staff),
      attendance: {},
    };
  const currentDraft = editable ? draftFor(editable) : undefined;
  // Eligibility depends on the session's category (its programmes).
  const sessionCategory = categories.find((c) => c.code === currentDraft?.details.category);
  const clients = workspace.clients.map((client) => ({
    ...client,
    eligible: eligibleFor(client, sessionCategory),
  }));

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
    setStep((current) => (current === "review" ? "attendance" : current));
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
    updateDraft(editable, (draft) => ({ ...draft, details: { ...draft.details, ...updates } }));
  };

  const select = (key: string) => {
    setSelectedKey(key);
    setSearch("");
    setView("session");
    setStep("details");
    setEditorErrors({});
    setEditorStatus("");
    if (key !== selected?.key) setDetailError(null);
  };

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

  const toAttendance = () => {
    if (!currentDraft) return;
    const errors = detailsErrors(currentDraft.details, categories);
    setEditorErrors(errors);
    if (Object.keys(errors).length) {
      setEditorStatus("Complete the session details to continue.");
      return;
    }
    setEditorStatus("");
    setStep("attendance");
    scrollToTop();
  };

  const review = () => {
    if (!editable || !currentDraft) return;
    setStatusMessage("");
    const rows = selectableRows(currentDraft);
    const errors = detailsErrors(currentDraft.details, categories);
    setEditorErrors(errors);
    if (Object.keys(errors).length) {
      setEditorStatus("Complete the session details before reviewing the session.");
      setStep("details");
      return;
    }
    let problem = "";
    if (!rows.length) problem = "No eligible clients match the selected filters.";
    else if (rows.some((row) => !row.entry.attendance)) {
      problem = "Select an attendance status for every listed client.";
    } else if (rows.some((row) => row.entry.riskDisclosure && !row.entry.observation?.trim())) {
      problem = "Record an observation for every client with a risk disclosure.";
    }
    setEditorStatus(problem);
    if (problem || !accessToken) return;
    // Owner decision 2026-10-22: risk language in an observation is flagged
    // automatically — pre-ticked as a disclosure with a follow-up; unticking
    // it needs a reason (the server enforces the same rule on confirm).
    setEditorStatus("Checking observations for risk language…");
    screenGroupEntries(
      accessToken,
      rows.map(({ client, entry }) => ({
        patient: client.id,
        observation: entry.observation ?? "",
      })),
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
        setStep("review");
        scrollToTop();
      })
      .catch((err) =>
        setEditorStatus(
          err instanceof ApiError
            ? err.message
            : "Couldn't screen the observations for risk language.",
        ),
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
        setStep("details");
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

  const categoryLabel = (form: SessionForm) => {
    const category = categories.find((c) => c.code === form.category);
    return category?.is_other ? form.categoryOther.trim() : (category?.display ?? "");
  };
  // While a session is being recorded, show what has been entered so far.
  const shownItem: WorkspaceItem | undefined =
    selected && editable && currentDraft
      ? {
          ...selected,
          date: currentDraft.details.sessionDate || selected.date,
          time: currentDraft.details.startTime,
          endTime: currentDraft.details.endTime,
          topic: currentDraft.details.topic.trim() || selected.topic,
          category: categoryLabel(currentDraft.details) || selected.category,
          facilitator: facilitatorName(currentDraft.details),
          location: currentDraft.details.location.trim(),
        }
      : selected;
  const stepIndex = STEPS.findIndex(([key]) => key === step);

  return (
    <div className="animate-fade-in">
      <PageHeader
        title="Group psychotherapy"
        subtitle="One shared session, a separate record for each client"
        actions={
          <button type="button" className={BTN} onClick={startNewSession}>
            New session
          </button>
        }
      />

      <div
        className="mb-4 flex gap-1 border-b border-surface-border"
        role="tablist"
        aria-label="Group psychotherapy views"
      >
        {(
          [
            ["session", "Sessions"],
            ["utilisation", "Utilisation"],
            ["settings", "Settings"],
          ] as [PageView, string][]
        ).map(([key, label]) => (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={view === key}
            onClick={() => setView(key)}
            className={`-mb-px border-b-2 px-4 py-2.5 text-[13px] font-semibold transition-colors ${
              view === key
                ? "border-brand-green text-ink-900"
                : "border-transparent text-ink-500 hover:text-ink-900"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {(loadError || valueSets.error) && (
        <Callout tone="danger" role="alert" className="mb-4">
          {loadError || valueSets.error}
        </Callout>
      )}
      {statusMessage && (
        <Callout role="status" className="mb-4">
          {statusMessage}
        </Callout>
      )}

      {view === "utilisation" && <UtilisationView data={utilisation} error={utilisationError} />}

      {view === "settings" && (
        <div className="grid gap-4 [&>*]:min-w-0">
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
          <ProgrammeConfig
            categories={categories}
            programmes={workspace.programmes ?? []}
            canConfigure={workspace.can_configure}
            onCategories={(payload) =>
              setWorkspace((prev) => (prev ? { ...prev, categories: payload.results } : prev))
            }
            onProgrammes={(payload) =>
              setWorkspace((prev) => (prev ? { ...prev, programmes: payload.results } : prev))
            }
          />
        </div>
      )}

      {view === "session" && (
        <section
          className="grid items-start gap-4 lg:grid-cols-[300px_minmax(0,1fr)]"
          aria-label="Group sessions"
        >
          <SessionRail
            items={visibleItems}
            tab={tab}
            selectedKey={selected?.key ?? null}
            onTab={setTab}
            onSelect={select}
          />
          <div className="min-w-0 overflow-hidden rounded-xl border border-surface-border bg-surface-card">
            {!shownItem ? (
              <div className="flex flex-col items-center gap-3 px-6 py-16 text-center">
                <p className="text-sm text-ink-500">No sessions in this list.</p>
                <button type="button" className={BTN} onClick={startNewSession}>
                  New session
                </button>
              </div>
            ) : !editable ? (
              <SessionWorkspace
                item={shownItem}
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
                draft={undefined}
                onDraftChange={changeAttendance}
                observationOpen={{}}
                onToggleObservation={() => undefined}
                detail={detail?.id === selectedSessionId ? detail : null}
                detailError={detailError}
                onReview={review}
                onEditScheduled={() => undefined}
                onEditDetails={() => selectedSessionId && openDialog("session", selectedSessionId)}
                onCorrectEntry={() => selectedSessionId && openDialog("entry", selectedSessionId)}
                onOpenInterventions={(patientId) =>
                  navigate(clientRecordPath(patientId, "interventions"))
                }
              />
            ) : (
              <>
                <ol
                  className="flex flex-wrap gap-x-6 gap-y-2 border-b border-surface-border px-4 py-3 sm:px-8"
                  aria-label="Recording steps"
                >
                  {STEPS.map(([key, label], index) => {
                    const done = index < stepIndex;
                    const current = index === stepIndex;
                    return (
                      <li key={key}>
                        <button
                          type="button"
                          disabled={!done}
                          onClick={() => setStep(key)}
                          aria-current={current ? "step" : undefined}
                          className={`flex items-center gap-2 text-[13px] ${
                            current
                              ? "font-semibold text-ink-900"
                              : done
                                ? "text-brand-green hover:underline"
                                : "text-ink-400"
                          }`}
                        >
                          <span
                            className={`flex h-6 w-6 items-center justify-center rounded-full text-[11px] font-bold ${
                              current || done
                                ? "bg-brand-green text-on-primary"
                                : "bg-surface-bg text-ink-500"
                            }`}
                          >
                            {index + 1}
                          </span>
                          {label}
                        </button>
                      </li>
                    );
                  })}
                </ol>

                {step === "details" && currentDraft && (
                  <div className="grid gap-4 px-4 py-5 sm:px-8">
                    <Card title="Session details">
                      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 [&>*]:min-w-0">
                        {workspace.scheduled.length > 0 && (
                          <Field label="From the programme calendar" htmlFor="group-scheduled">
                            <select
                              id="group-scheduled"
                              className={INPUT}
                              value={editable.kind === "scheduled" ? editable.key : ""}
                              onChange={(e) => chooseScheduled(e.target.value)}
                            >
                              <option value="">Not scheduled: enter the details</option>
                              {workspace.scheduled.map((item) => {
                                const local = scheduledLocal(item);
                                return (
                                  <option key={item.key} value={item.key}>
                                    {local.date} {local.time} · {item.category} · {item.facilitator}
                                  </option>
                                );
                              })}
                            </select>
                          </Field>
                        )}
                        <SessionDetailsFields
                          idPrefix="group-editor"
                          form={currentDraft.details}
                          errors={editorErrors}
                          categories={categories}
                          staff={staff}
                          onChange={changeDetails}
                          documentedBy={
                            <Field
                              label="Documented by"
                              htmlFor="group-author"
                              hint="Your signed-in account."
                            >
                              <input
                                id="group-author"
                                className={INPUT}
                                value={currentUser.name}
                                readOnly
                              />
                            </Field>
                          }
                        />
                      </div>
                    </Card>
                    <StepStatus text={editorStatus} />
                    <div className="flex justify-end">
                      <button type="button" className={BTN} onClick={toAttendance}>
                        Next: attendance
                      </button>
                    </div>
                  </div>
                )}

                {step === "attendance" && (
                  <>
                    <SessionWorkspace
                      item={shownItem}
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
                        clients.map((c) => [
                          c.id,
                          Boolean(observationOpen[`${shownItem.key}:${c.id}`]),
                        ]),
                      )}
                      onToggleObservation={(clientId) =>
                        setObservationOpen((prev) => ({
                          ...prev,
                          [`${shownItem.key}:${clientId}`]: !prev[`${shownItem.key}:${clientId}`],
                        }))
                      }
                      detail={null}
                      detailError={null}
                      onReview={review}
                      onEditScheduled={() => setStep("details")}
                      onEditDetails={() => undefined}
                      onCorrectEntry={() => undefined}
                      onOpenInterventions={() => undefined}
                    />
                    {editorStatus && (
                      <div className="px-4 pb-4 sm:px-8">
                        <StepStatus text={editorStatus} />
                      </div>
                    )}
                  </>
                )}

                {step === "review" && reviewDetails && (
                  <div className="px-4 py-5 sm:px-8">
                    <ReviewPanel
                      summary={{
                        category: categoryLabel(reviewDetails),
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
                      onReturn={() => setStep("attendance")}
                    />
                    <StepStatus text={editorStatus} />
                  </div>
                )}
              </>
            )}
          </div>
        </section>
      )}

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

/** A problem or progress note for the step being completed. */
function StepStatus({ text }: { text: string }) {
  return (
    <div
      role="status"
      aria-live="polite"
      className={text ? "mt-3 rounded-lg bg-surface-bg px-3 py-2.5 text-xs text-ink-900" : ""}
    >
      {text}
    </div>
  );
}
