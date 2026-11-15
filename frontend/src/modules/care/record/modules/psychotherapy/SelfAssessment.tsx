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

// The therapist's reflection on a signed session: a short served questionnaire,
// then — if they want it — the supervision request it raises. The reflection is
// workforce data kept with the session; only its author can read it.

const SUPERVISION_OPTIONS = [
  { code: "YES", display: "Yes" },
  { code: "NO", display: "No" },
];

type SupervisionDecision = "" | "YES" | "NO";
type Mode = "questions" | "supervision" | "done";

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
}: {
  config: PsyConfig;
  note: PsyNote;
  save: (payload: SelfAssessmentPayload) => Promise<boolean>;
  onClose: () => void;
}) {
  const record = note.session.therapist_self_assessment;
  const questions = config.self_assessment.questions;
  const supervisionCopy = config.self_assessment.supervision;
  const requestOpen = Boolean(record?.supervision.request_id);
  const [mode, setMode] = useState<Mode>(record ? "done" : "questions");
  const [answers, setAnswers] = useState<Record<string, string>>(record?.answers ?? {});
  const [decision, setDecision] = useState<SupervisionDecision>(record?.supervision.decision ?? "");
  const [focus, setFocus] = useState(record?.supervision.focus ?? "");
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

  function toSupervision() {
    const missing = visible
      .filter((q) => q.required && !(answers[q.key] ?? "").trim())
      .map((q) => q.key);
    setInvalid(missing);
    if (missing.length) {
      setError("Answer every question before continuing.");
      return;
    }
    setError(null);
    setMode("supervision");
  }

  async function submit() {
    // An open request is never withdrawn here — saving keeps it and refreshes it.
    const wantsSupervision = requestOpen || decision === "YES";
    if (!wantsSupervision && !decision) {
      setError("Choose whether you need supervision for this session.");
      return;
    }
    if (wantsSupervision && !focus.trim()) {
      setError(`${supervisionCopy.focus_label} Add a short focus before requesting supervision.`);
      return;
    }
    setSaving(true);
    setError(null);
    const saved = Object.fromEntries(visible.map((q) => [q.key, (answers[q.key] ?? "").trim()]));
    const ok = await save({
      answers: saved,
      supervision: wantsSupervision ? "YES" : "NO",
      supervision_focus: focus.trim(),
      request_supervision: wantsSupervision,
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
            <button type="button" className={BTN} onClick={toSupervision}>
              Continue to supervision
            </button>
          </div>
        </>
      )}

      {mode === "supervision" && (
        <>
          <div>
            <div className={FIELD_LABEL}>Supervision</div>
            <h1 className="font-display text-xl font-semibold text-ink-900">
              Request supervision?
            </h1>
            <p className="mt-1 max-w-[620px] text-[13px] leading-6 text-ink-500">
              {supervisionCopy.prompt}
            </p>
          </div>

          <div className="rounded-lg border border-surface-border bg-surface-card p-4">
            {requestOpen ? (
              <Callout tone="info">
                A supervision request is already open for this session. Saving keeps it open and
                refreshes the note your supervisor sees.
              </Callout>
            ) : (
              <fieldset>
                <legend className={FIELD_LABEL}>Supervision needed</legend>
                <div className="mt-2">
                  <RadioChoices
                    name="self-assessment-supervision"
                    options={SUPERVISION_OPTIONS}
                    value={decision}
                    onChange={(code) => {
                      setDecision(code as SupervisionDecision);
                      setError(null);
                    }}
                  />
                </div>
              </fieldset>
            )}
            {(requestOpen || decision === "YES") && (
              <>
                <label className="mt-4 flex flex-col gap-1.5">
                  <span className={FIELD_LABEL}>{supervisionCopy.focus_label}</span>
                  <AutoResizeTextarea
                    rows={3}
                    value={focus}
                    placeholder={supervisionCopy.focus_placeholder}
                    onChange={(e) => {
                      setFocus(e.target.value);
                      setError(null);
                    }}
                  />
                </label>
                <Callout tone="info" className="mt-4">
                  A supervision request is opened with this reflection. Your supervisor sees the
                  reflection and the session date — never the client’s note.
                </Callout>
              </>
            )}
          </div>

          <ErrorNote>{error}</ErrorNote>
          <div className="flex flex-wrap gap-2">
            <button type="button" className={BTN_GHOST} onClick={() => setMode("questions")}>
              Back
            </button>
            <button type="button" className={BTN} disabled={saving} onClick={() => void submit()}>
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
            {decision === "YES" ? (
              <div className="mt-2">
                <Callout tone="success" label="Requested">
                  A supervision request is open with this reflection.
                </Callout>
                <div className="mt-2.5">
                  <div className="text-[12px] font-semibold text-ink-700">
                    {supervisionCopy.focus_label}
                  </div>
                  <p className="whitespace-pre-wrap text-[13.5px] leading-6 text-ink-900">
                    {focus}
                  </p>
                </div>
              </div>
            ) : (
              <p className="mt-1 text-[13px] text-ink-500">
                No supervision was requested for this session.
              </p>
            )}
          </section>

          <div className="flex flex-wrap gap-2">
            <button type="button" className={BTN} onClick={onClose}>
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
            {decision !== "YES" && (
              <button
                type="button"
                className={BTN_GHOST}
                onClick={() => {
                  setDecision("YES");
                  setError(null);
                  setMode("supervision");
                }}
              >
                Request supervision
              </button>
            )}
          </div>
        </>
      )}
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

function BackButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex w-fit items-center gap-1.5 text-[12.5px] font-semibold text-brand-green hover:underline"
    >
      <ArrowLeft className="h-4 w-4" /> Back to session
    </button>
  );
}
