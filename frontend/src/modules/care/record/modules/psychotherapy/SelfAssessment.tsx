import { ArrowLeft, CheckCircle2, X } from "lucide-react";
import { useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useDialogA11y } from "../../../../../components/useDialogA11y";
import type {
  PsyConfig,
  PsyNote,
  SelfAssessmentPayload,
  SelfAssessmentQuestion,
} from "../../../../../lib/psychotherapyNoteApi";
import { AutoResizeTextarea } from "../../../shared/AutoResizeTextarea";
import { formatDateTime } from "../../../shared/format";
import { BTN, BTN_GHOST, FIELD_LABEL } from "../../../shared/styles";
import { Callout, ErrorNote, RadioChoices } from "../../../shared/ui";

// The therapist's reflection on a signed session, and the supervision request
// it can raise. The reflection is workforce data kept with the session and is
// shown only to its author. Requesting supervision is a separate, deliberately
// bare page: just the focus the supervisor needs, never the therapy note.

type Mode = "questions" | "done";

function shown(question: SelfAssessmentQuestion, answers: Record<string, string>) {
  return (
    !question.show_when || question.show_when.in.includes(answers[question.show_when.key] ?? "")
  );
}

function answerLabel(question: SelfAssessmentQuestion, value: string) {
  if (question.kind !== "CHOICE") return value;
  return question.options.find((o) => o.code === value)?.display ?? value;
}

/** The prompt shown straight after the note is signed. */
export function SelfAssessmentPrompt({
  intro,
  onStart,
  onSkip,
}: {
  intro: string;
  onStart: () => void;
  onSkip: () => void;
}) {
  const ref = useDialogA11y<HTMLDivElement>(true, onSkip);
  return createPortal(
    <>
      <div className="fixed inset-0 z-[110] bg-surface-scrim" onClick={onSkip} />
      <div className="fixed inset-0 z-[120] flex items-center justify-center p-3 sm:p-6">
        <div
          ref={ref}
          role="dialog"
          aria-modal="true"
          aria-labelledby="psy-self-assessment-prompt-title"
          aria-describedby="psy-self-assessment-prompt-intro"
          className="flex w-full max-w-[480px] flex-col overflow-hidden rounded-[14px] bg-surface-card shadow-md"
        >
          <div className="flex items-start justify-between gap-3 border-b border-surface-border px-5 py-4">
            <div>
              <h2
                id="psy-self-assessment-prompt-title"
                className="font-display text-lg font-bold text-ink-900"
              >
                Self-assessment
              </h2>
              <p className="mt-0.5 text-[12.5px] text-ink-500">
                The note is signed. Take a moment to reflect on your own practice in this session.
              </p>
            </div>
            <button
              type="button"
              aria-label="Close"
              onClick={onSkip}
              className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-[9px] border border-surface-border text-ink-700 hover:bg-surface-bg"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
          <p
            id="psy-self-assessment-prompt-intro"
            className="px-5 py-4 text-[13.5px] leading-6 text-ink-700"
          >
            {intro}
          </p>
          <div className="flex flex-wrap justify-end gap-2 border-t border-surface-border px-5 py-3">
            <button type="button" className={BTN_GHOST} onClick={onSkip}>
              Not now
            </button>
            <button type="button" className={BTN} onClick={onStart}>
              Start self-assessment
            </button>
          </div>
        </div>
      </div>
    </>,
    document.body,
  );
}

/** The dedicated reflection page, opened from the prompt or the signed note. */
export function SelfAssessmentPage({
  config,
  note,
  save,
  onClose,
  onRequestSupervision,
}: {
  config: PsyConfig;
  note: PsyNote;
  save: (payload: SelfAssessmentPayload) => Promise<boolean>;
  onClose: () => void;
  onRequestSupervision: () => void;
}) {
  const record = note.session.therapist_self_assessment;
  const questions = config.self_assessment.questions;
  const supervisionCopy = config.self_assessment.supervision;
  const requestStatus = record?.supervision.request_status ?? null;
  const requestOpen = requestStatus === "OPEN";
  const requestActive = requestStatus === "OPEN" || requestStatus === "SCHEDULED";
  const [mode, setMode] = useState<Mode>(record ? "done" : "questions");
  const [answers, setAnswers] = useState<Record<string, string>>(record?.answers ?? {});
  const [invalid, setInvalid] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const visible = questions.filter((q) => shown(q, answers));

  if (!note.is_author) {
    return (
      <Page>
        <Callout tone="warning">
          Only the clinician who wrote this note can complete its self-assessment.
        </Callout>
        <BackButton onClick={onClose} />
      </Page>
    );
  }

  if (note.status !== "SIGNED") {
    return (
      <Page>
        <Callout tone="warning">The self-assessment opens once the session note is signed.</Callout>
        <BackButton onClick={onClose} />
      </Page>
    );
  }

  function setAnswer(key: string, value: string) {
    setAnswers((a) => ({ ...a, [key]: value }));
    setInvalid((keys) => keys.filter((k) => k !== key));
    setError(null);
  }

  async function saveReflection() {
    const missing = visible
      .filter((q) => q.required && !(answers[q.key] ?? "").trim())
      .map((q) => q.key);
    setInvalid(missing);
    if (missing.length) {
      setError("Answer every question before saving.");
      return;
    }
    setSaving(true);
    setError(null);
    const saved = Object.fromEntries(visible.map((q) => [q.key, (answers[q.key] ?? "").trim()]));
    const ok = await save({
      answers: saved,
      // An OPEN request is preserved and refreshed; any other state leaves the
      // reflection alone, so a completed request is never raised again by an edit.
      supervision: requestStatus ? "YES" : "",
      supervision_focus: record?.supervision.focus ?? "",
      request_supervision: requestOpen,
    });
    setSaving(false);
    if (ok) setMode("done");
    else setError("Couldn't save the reflection. Check the connection and try again.");
  }

  return (
    <Page>
      <BackButton onClick={onClose} />

      {mode === "questions" && (
        <>
          <div>
            <div className={FIELD_LABEL}>After the session</div>
            <h1 className="font-display text-xl font-semibold text-ink-900">
              Therapist self-assessment
            </h1>
            <p className="mt-1 max-w-[620px] text-[13px] leading-6 text-ink-500">
              {config.self_assessment.intro}
            </p>
          </div>

          <ol className="flex flex-col gap-3">
            {visible.map((q, index) => (
              <li
                key={q.key}
                className="rounded-lg border border-surface-border bg-surface-card p-4"
              >
                <fieldset>
                  <legend className="text-[13.5px] font-semibold text-ink-900">
                    {index + 1}. {q.prompt}
                  </legend>
                  <div className="mt-2.5">
                    {q.kind === "CHOICE" ? (
                      <RadioChoices
                        name={`self-assessment-${q.key}`}
                        options={q.options}
                        value={answers[q.key] ?? ""}
                        onChange={(code) => setAnswer(q.key, code)}
                      />
                    ) : (
                      <AutoResizeTextarea
                        rows={q.rows}
                        value={answers[q.key] ?? ""}
                        aria-label={q.prompt}
                        placeholder={q.required ? "Required" : "Optional"}
                        onChange={(e) => setAnswer(q.key, e.target.value)}
                      />
                    )}
                  </div>
                  {invalid.includes(q.key) && (
                    <p className="mt-1.5 text-[12px] font-medium text-priority-red">
                      Answer this question.
                    </p>
                  )}
                </fieldset>
              </li>
            ))}
          </ol>

          <ErrorNote>{error}</ErrorNote>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className={BTN}
              disabled={saving}
              onClick={() => void saveReflection()}
            >
              {saving ? "Saving…" : "Save reflection"}
            </button>
          </div>
        </>
      )}

      {mode === "done" && (
        <>
          <div className="flex items-start gap-2.5">
            <CheckCircle2 aria-hidden="true" className="mt-0.5 h-5 w-5 text-brand-green" />
            <div>
              <div className={FIELD_LABEL}>Self-assessment</div>
              <h1 className="font-display text-xl font-semibold text-ink-900">
                Reflection recorded
              </h1>
              <p className="mt-1 text-[12.5px] text-ink-500">
                {record?.completed_at
                  ? `Completed ${formatDateTime(record.completed_at)}`
                  : "Saved"}
                {record?.updated_at && record.updated_at !== record.completed_at
                  ? ` · updated ${formatDateTime(record.updated_at)}`
                  : ""}
                . Kept with the signed note and shown only to you.
              </p>
            </div>
          </div>

          <section className="rounded-lg border border-surface-border bg-surface-card p-4">
            <h2 className="text-[13px] font-bold text-ink-900">Your reflection</h2>
            <dl className="mt-2.5 flex flex-col gap-2.5">
              {visible
                .filter((q) => (answers[q.key] ?? "").trim())
                .map((q) => (
                  <div key={q.key}>
                    <dt className="text-[12px] font-semibold text-ink-700">{q.label}</dt>
                    <dd className="whitespace-pre-wrap text-[13.5px] leading-6 text-ink-900">
                      {answerLabel(q, answers[q.key] ?? "")}
                    </dd>
                  </div>
                ))}
            </dl>
          </section>

          <section className="rounded-lg border border-surface-border bg-surface-card p-4">
            <h2 className="text-[13px] font-bold text-ink-900">Supervision</h2>
            {requestActive ? (
              <div className="mt-2">
                <Callout
                  tone="success"
                  label={requestStatus === "SCHEDULED" ? "Scheduled" : "Requested"}
                >
                  {requestStatus === "SCHEDULED"
                    ? "A supervision request is scheduled with your supervisor."
                    : "A supervision request is open with this reflection."}
                </Callout>
                {record?.supervision.focus && (
                  <div className="mt-2.5">
                    <div className="text-[12px] font-semibold text-ink-700">
                      {supervisionCopy.focus_label}
                    </div>
                    <p className="whitespace-pre-wrap text-[13.5px] leading-6 text-ink-900">
                      {record.supervision.focus}
                    </p>
                  </div>
                )}
              </div>
            ) : (
              <div className="mt-1">
                {requestStatus === "COMPLETED" && (
                  <p className="mb-1.5 text-[12px] text-ink-500">
                    Your last supervision request for this session is complete.
                  </p>
                )}
                <p className="text-[13px] text-ink-700">{supervisionCopy.prompt}</p>
                <p className="mt-1 text-[12px] text-ink-500">
                  Your supervisor sees your reflection and the session date — never the client’s
                  note.
                </p>
                <button type="button" className={`${BTN} mt-3`} onClick={onRequestSupervision}>
                  {requestStatus === "COMPLETED"
                    ? "Request supervision again"
                    : "Request supervision"}
                </button>
              </div>
            )}
          </section>

          <div className="flex flex-wrap gap-2">
            <button type="button" className={requestActive ? BTN : BTN_GHOST} onClick={onClose}>
              Back to session
            </button>
            <button
              type="button"
              className={BTN_GHOST}
              onClick={() => {
                setError(null);
                setMode("questions");
              }}
            >
              Edit reflection
            </button>
          </div>
        </>
      )}
    </Page>
  );
}

/** The dedicated supervision request: just the focus, then a clean success. */
export function SupervisionRequestPage({
  config,
  note,
  save,
  onBack,
  onClose,
}: {
  config: PsyConfig;
  note: PsyNote;
  save: (payload: SelfAssessmentPayload) => Promise<boolean>;
  onBack: () => void;
  onClose: () => void;
}) {
  const record = note.session.therapist_self_assessment;
  const supervisionCopy = config.self_assessment.supervision;
  const [focus, setFocus] = useState(record?.supervision.focus ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const requestStatus = record?.supervision.request_status ?? null;
  const requestActive = requestStatus === "OPEN" || requestStatus === "SCHEDULED";

  if (!note.is_author || note.status !== "SIGNED") {
    return (
      <Page>
        <Callout tone="warning">
          The supervision request is only available to the clinician who signed this note.
        </Callout>
        <BackButton onClick={onClose} />
      </Page>
    );
  }

  if (!record) {
    return (
      <Page>
        <Callout tone="warning">
          Complete the self-assessment first — the supervision request is raised from it.
        </Callout>
        <BackButton onClick={onBack} label="Back to reflection" />
      </Page>
    );
  }

  async function submit() {
    if (!focus.trim()) {
      setError(`${supervisionCopy.focus_label} Add a short focus before sending.`);
      return;
    }
    setSaving(true);
    setError(null);
    const ok = await save({
      answers: record?.answers ?? {},
      supervision: "YES",
      supervision_focus: focus.trim(),
      request_supervision: true,
    });
    setSaving(false);
    if (ok) setSent(true);
    else setError("Couldn't send the supervision request. Check the connection and try again.");
  }

  if (sent || requestActive) {
    const scheduled = !sent && requestStatus === "SCHEDULED";
    return (
      <Page>
        <div className="flex items-start gap-3">
          <CheckCircle2 aria-hidden="true" className="mt-0.5 h-6 w-6 text-brand-green" />
          <div>
            <div className={FIELD_LABEL}>Supervision</div>
            <h1 className="font-display text-xl font-semibold text-ink-900">
              {sent
                ? "Supervision request sent"
                : scheduled
                  ? "Supervision request scheduled"
                  : "Supervision request open"}
            </h1>
            <p className="mt-1 max-w-[520px] text-[13px] leading-6 text-ink-500">
              {scheduled
                ? "Your supervision session is scheduled. Your supervisor has your reflection and the focus you set."
                : "Your supervisor can now see your reflection and the focus you set. You’ll be notified when it is scheduled."}
            </p>
          </div>
        </div>

        <section className="rounded-lg border border-surface-border bg-surface-card p-4">
          <h2 className="text-[13px] font-bold text-ink-900">{supervisionCopy.focus_label}</h2>
          <p className="mt-2 whitespace-pre-wrap text-[13.5px] leading-6 text-ink-900">{focus}</p>
        </section>

        <div className="flex flex-wrap gap-2">
          <button type="button" className={BTN} onClick={onClose}>
            Back to session
          </button>
          <button type="button" className={BTN_GHOST} onClick={onBack}>
            View reflection
          </button>
        </div>
      </Page>
    );
  }

  return (
    <Page>
      <BackButton onClick={onBack} label="Back to reflection" />

      <div>
        <div className={FIELD_LABEL}>Supervision</div>
        <h1 className="font-display text-xl font-semibold text-ink-900">Request supervision</h1>
        <p className="mt-1 max-w-[620px] text-[13px] leading-6 text-ink-500">
          Share the one thing you would like your supervisor to help with. Your reflection and the
          session date go with it; the client’s note never does.
        </p>
      </div>

      <section className="rounded-lg border border-surface-border bg-surface-card p-4">
        <label className="flex flex-col gap-1.5">
          <span className={FIELD_LABEL}>{supervisionCopy.focus_label}</span>
          <AutoResizeTextarea
            rows={5}
            value={focus}
            aria-required="true"
            placeholder={supervisionCopy.focus_placeholder}
            onChange={(e) => {
              setFocus(e.target.value);
              setError(null);
            }}
          />
        </label>
      </section>

      <ErrorNote>{error}</ErrorNote>
      <div className="flex flex-wrap gap-2">
        <button type="button" className={BTN} disabled={saving} onClick={() => void submit()}>
          {saving ? "Sending…" : "Send supervision request"}
        </button>
        <button type="button" className={BTN_GHOST} onClick={onBack}>
          Cancel
        </button>
      </div>
    </Page>
  );
}

function Page({ children }: { children: ReactNode }) {
  return (
    <div className="mx-auto flex w-full max-w-[760px] flex-col gap-4 px-4 py-5 sm:px-6">
      {children}
    </div>
  );
}

function BackButton({
  onClick,
  label = "Back to session",
}: {
  onClick: () => void;
  label?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex w-fit items-center gap-1.5 text-[12.5px] font-semibold text-brand-green hover:underline"
    >
      <ArrowLeft className="h-4 w-4" /> {label}
    </button>
  );
}
