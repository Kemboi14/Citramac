import type { ReactNode } from "react";
import type { Detection, GoalDecision, PsyConfig, PsyNote, SafetyAnswer } from "../../../../../lib/psychotherapyNoteApi";
import { BTN, BTN_GHOST, BTN_SM } from "../../../shared/styles";
import { EXAMPLE_ANSWERS } from "./exampleSession";
import { answerText, hhmm, modeLabel, QUESTION_COUNT, REVIEW_STEP, SAFETY_STEP } from "./helpers";

// The conversation, derived from the server draft (questions asked so far,
// the clinician's answers, the inline checks the server ran on them) plus a
// few page-only acknowledgements. Nothing here decides a rule — the server
// detects, the clinician decides.

export interface Ack { anchor: string; text: string }

const DECISIONS: { code: Exclude<GoalDecision, "CONFIRMED" | "DISMISSED">; label: string }[] = [
  { code: "PROGRESS", label: "Progress" },
  { code: "NO_CHANGE", label: "No clear change" },
  { code: "BARRIER", label: "Barrier" },
  { code: "NOT_RELEVANT", label: "Not relevant" },
];

const PILL = "rounded-full border px-3 py-1 text-[12.5px] font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-60";
const pill = (on: boolean) => `${PILL} ${on ? "border-brand-green bg-brand-green text-on-primary" : "border-surface-border bg-surface-card text-ink-900 hover:bg-surface-bg"}`;

function Sys({ children, id }: { children: ReactNode; id?: string }) {
  return (
    <div id={id} className="flex scroll-mt-4 gap-2.5">
      <div aria-hidden className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full bg-brand-green-tint text-[12px] font-bold text-brand-green">C</div>
      <div className="min-w-0 flex-1 text-[13.5px] leading-relaxed text-ink-900">{children}</div>
    </div>
  );
}

function Mine({ children, foot }: { children: ReactNode; foot?: ReactNode }) {
  return (
    <div className="flex flex-col items-end gap-1">
      <div className="max-w-[85%] whitespace-pre-wrap rounded-[14px] rounded-br-sm bg-surface-bg px-3.5 py-2.5 text-[13.5px] text-ink-900">{children}</div>
      {foot && <div className="flex items-center gap-2 text-[11px] text-ink-500">{foot}</div>}
    </div>
  );
}

/** The flagged sentence with the matched phrase marked (offsets are within the passage). */
function Highlight({ d }: { d: Detection }) {
  const from = Math.max(0, d.passage_start);
  const to = Math.max(from, d.passage_end);
  return (
    <span>
      “{d.passage.slice(0, from)}
      <mark className="rounded bg-priority-red-tint px-0.5 text-priority-red">{d.passage.slice(from, to)}</mark>
      {d.passage.slice(to)}”
    </span>
  );
}

/** A detection category for display: the served concern label where the codes match. */
function categoryLabel(config: PsyConfig, code: string) {
  const served = config.concerns.categories.find((c) => c.code === code)?.label;
  if (served) return served;
  const words = code.replace(/_/g, " ").trim();
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : "Safety language";
}

export interface ThreadHandlers {
  onEdit: (key: string) => void;
  onReview: (key: string) => void;
  onModel: (code: string, include: boolean) => void;
  onGoal: (index: number, decision: GoalDecision) => void;
  onSafety: (answer: Exclude<SafetyAnswer, "">) => void;
  onOpenRisk: () => void;
  onOpenNotes: () => void;
}

/** The example session: the fixed sample answers, page state only. */
export function ExampleThread({ config, onLeave }: { config: PsyConfig; onLeave: () => void }) {
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-priority-orange bg-priority-orange-tint px-3 py-2 text-[12.5px] text-priority-orange">
        <span><strong>Example — not saved.</strong> Sample answers show how the workspace works. Nothing here is stored or can be signed.</span>
        <button type="button" className={`${BTN_GHOST} ${BTN_SM}`} onClick={onLeave}>Leave example</button>
      </div>
      <Sys><p>Example session. I’ll ask five questions, one at a time, then the safety question.</p></Sys>
      {config.questions.map((q, i) => (
        <div key={q.key} className="flex flex-col gap-3">
          <Sys>
            <span className="text-[11px] font-semibold uppercase tracking-wide text-ink-500">Question {i + 1} of {QUESTION_COUNT}</span>
            <div className="font-semibold">{q.title}</div>
            <div className="text-[12.5px] text-ink-500">{q.hint}</div>
          </Sys>
          <Mine foot={<span>Typed · example</span>}>{EXAMPLE_ANSWERS[q.key]}</Mine>
        </div>
      ))}
      <Sys><p>In a real session the safety question comes next, then the note is organised on the server for your review.</p></Sys>
    </div>
  );
}

export function Thread({ config, note, step, acks, busy, h, reviewExtras }: {
  config: PsyConfig;
  note: PsyNote;
  step: number;
  acks: Ack[];
  busy: boolean;
  h: ThreadHandlers;
  reviewExtras: ReactNode;
}) {
  const locked = note.status === "SIGNED" || !note.is_author;
  const ackFor = (anchor: string) => acks.filter((a) => a.anchor === anchor).map((a, i) => <Sys key={`${anchor}-${i}`}><p>{a.text}</p></Sys>);
  const shown = Math.min(step, QUESTION_COUNT - 1);
  const decided = note.goal_links.filter((g) => DECISIONS.some((d) => d.code === g.status));
  const goals = [
    ...note.goal_suggestions.map((g) => ({ index: g.goal_index, goal: g.goal, evidence: g.evidence, decision: null as GoalDecision | null })),
    ...decided.map((g) => ({ index: g.goal_index, goal: g.goal, evidence: g.evidence ?? "", decision: g.status })),
  ].sort((a, b) => a.index - b.index);
  const link = note.safety_detail.risk_link;
  const unreviewed = note.detections.filter((d) => !d.resolution).length;

  return (
    <div className="flex flex-col gap-4">
      <Sys>
        <p>Session started for <strong>{note.patient.name}</strong>. I’ll ask five questions, one at a time, then the safety question. Answer naturally; there’s no need for headings or formal language. Your note builds on the right as you go.</p>
      </Sys>
      {config.questions.slice(0, shown + 1).map((q, i) => {
        const text = answerText(note, q.key);
         
        const answer = note.answers[q.key];
        const flags = note.detections.filter((d) => d.question === q.key);
        const language = note.flags.filter((f) => f.where === q.key);
        return (
          <div key={q.key} className="flex flex-col gap-3">
            <Sys id={`psy-m-q${i}`}>
              <span className="text-[11px] font-semibold uppercase tracking-wide text-ink-500">Question {i + 1} of {QUESTION_COUNT}</span>
              <div className="font-semibold">{q.title}</div>
              <div className="text-[12.5px] text-ink-500">{q.hint}</div>
            </Sys>
            {text.trim() && (
              <Mine foot={<>
                <span>{modeLabel(answer?.mode)}{answer?.answered_at ? ` · ${hhmm(answer.answered_at)}` : ""}</span>
                {!locked && <button type="button" className="font-semibold text-brand-green hover:underline" onClick={() => h.onEdit(q.key)}>Edit</button>}
              </>}>{text}</Mine>
            )}
            {flags.length > 0 && (
              <Sys>
                <div role="status" className="flex flex-col gap-2 rounded-lg border border-priority-red bg-priority-red-tint p-3">
                  <strong className="text-priority-red">{config.detection_prompt}</strong>
                  <span className="text-[12.5px] text-ink-500">{config.detection_note}</span>
                  {flags.map((d) => (
                    <div key={d.key} className="flex flex-col gap-1.5 rounded-md bg-surface-card p-2 text-[13px]">
                      <Highlight d={d} />
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="rounded-full bg-priority-red-tint px-2 py-0.5 text-[11px] font-semibold text-priority-red">{categoryLabel(config, d.category)}</span>
                        {d.source === "translation" && <span className="text-[11px] text-ink-500">in the English translation</span>}
                        {d.resolution
                          ? <span className="rounded-full bg-brand-green-tint px-2 py-0.5 text-[11px] font-semibold text-brand-green">Reviewed {hhmm(d.resolution.at)} · {d.resolution.by}</span>
                          : <button type="button" className={`${BTN_GHOST} ${BTN_SM}`} disabled={locked || busy} onClick={() => h.onReview(d.key)}>Mark reviewed</button>}
                      </div>
                    </div>
                  ))}
                  {step < SAFETY_STEP
                    ? <span className="text-[12px] text-ink-500">You will be asked the safety question after question 5.</span>
                    : note.safety_answer === "YES" && !locked && <div><button type="button" className={`${BTN_GHOST} ${BTN_SM}`} onClick={h.onOpenRisk}>Open risk assessment</button></div>}
                </div>
              </Sys>
            )}
            {language.length > 0 && (
              <Sys>
                <div className="flex flex-col gap-1 rounded-lg border border-priority-orange bg-priority-orange-tint p-3">
                  <strong className="text-[13px]">Language suggestion</strong>
                  {language.map((f, n) => (
                    <div key={n} className="text-[13px]"><mark className="rounded bg-priority-orange-tint px-0.5">{f.term}</mark> {f.suggestion}</div>
                  ))}
                  <span className="text-[12px] text-ink-500">Advisory only — the note keeps your words unless you edit them.</span>
                </div>
              </Sys>
            )}
            {q.key === "q3" && text.trim() && note.models_detected.length > 0 && (
              <Sys>
                <p>I recognised {note.models_detected.length === 1 ? "this approach" : "these approaches"}. Tap to include or remove from the note.</p>
                <div className="mt-1.5 flex flex-wrap gap-1.5">
                  {note.models_detected.map((m) => (
                    <button key={m.code} type="button" aria-pressed={m.included} disabled={locked || busy} className={pill(m.included)}
                      title={m.how === "named" ? "Named by you" : `Suggested by the elements you described: ${m.concepts.join(", ")}`}
                      onClick={() => h.onModel(m.code, !m.included)}>
                      {m.name}{m.how === "suggested" ? " · suggested" : ""}
                    </button>
                  ))}
                </div>
              </Sys>
            )}
            {ackFor(`q${i}`)}
          </div>
        );
      })}
      {goals.length > 0 && note.status === "DRAFT" && (
        <Sys>
          <div className="flex flex-col gap-2 rounded-lg border border-surface-border p-3">
            <strong className="text-[13px]">Possible links to the treatment plan</strong>
            <span className="text-[12px] text-ink-500">Nothing is added to the note until you decide.</span>
            {goals.map((g) => (
              <div key={g.index} className="flex flex-col gap-1.5 border-t border-surface-border pt-2">
                <div className="text-[13.5px]"><span className="font-mono text-brand-green">G{g.index + 1}</span> {g.goal}</div>
                {g.evidence && <div className="border-l-2 border-surface-border pl-2 text-[12.5px] text-ink-700">“{g.evidence}”</div>}
                <div className="flex flex-wrap gap-1.5">
                  {DECISIONS.map((d) => (
                    <button key={d.code} type="button" aria-pressed={g.decision === d.code} disabled={locked || busy} className={pill(g.decision === d.code)}
                      onClick={() => h.onGoal(g.index, d.code)}>{d.label}</button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </Sys>
      )}
      {step >= SAFETY_STEP && (
        <Sys id="psy-m-safety">
          <span className="text-[11px] font-semibold uppercase tracking-wide text-ink-500">Required · every session</span>
          <div className="font-semibold">{config.safety_question}</div>
          <div className="mt-2 flex flex-wrap gap-1.5" role="radiogroup" aria-label="Safety answer">
            {config.safety_options.map((o) => (
              <button key={o.code} type="button" role="radio" aria-checked={note.safety_answer === o.code} disabled={locked || busy}
                className={`${pill(note.safety_answer === o.code)} uppercase tracking-wide`} onClick={() => h.onSafety(o.code)}>{o.label}</button>
            ))}
          </div>
          {note.safety_answer === "YES" && (
            <div className="mt-2 flex flex-wrap items-center gap-2">
              {link && <span className="rounded-full bg-priority-red-tint px-2 py-0.5 text-[11.5px] font-semibold text-priority-red">Linked risk assessment: {link.display_id} (opened {link.opened})</span>}
              {!locked && <button type="button" className={`${BTN_GHOST} ${BTN_SM}`} onClick={h.onOpenRisk}>{link ? "Edit risk details" : "Open risk workflow"}</button>}
            </div>
          )}
        </Sys>
      )}
      {note.safety_answer === "NOT_ASSESSED" && note.not_assessed_reason && <Mine>{note.not_assessed_reason}</Mine>}
      {ackFor("safety")}
      {step >= REVIEW_STEP && note.status === "DRAFT" && (
        <Sys id="psy-m-review">
          <p>Your draft note is ready. Review it, edit any section in place, then sign. It stays marked <strong>Draft — clinician review required</strong> until you do.</p>
          {unreviewed > 0 && <p className="mt-1 text-[12.5px] text-priority-red">{unreviewed} flagged passage{unreviewed === 1 ? "" : "s"} still to mark reviewed.</p>}
          <div className="mt-2"><button type="button" className={`${BTN} ${BTN_SM}`} onClick={h.onOpenNotes}>Review note</button></div>
          {reviewExtras}
        </Sys>
      )}
      {ackFor("review")}
      {note.status === "SIGNED" && (
        <Sys id="psy-m-review">
          <p>Note signed by {note.author}{note.signed_at ? ` on ${new Date(note.signed_at).toLocaleString("en-GB")}` : ""}. It is now locked; corrections are added as dated amendments.</p>
        </Sys>
      )}
    </div>
  );
}
