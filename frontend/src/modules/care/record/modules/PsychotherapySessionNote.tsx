import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { useAuth } from "../../../../auth/useAuth";
import { getInstruments, type InstrumentDef } from "../../../../lib/carePathwayApi";
import {
  amendPsyNote,
  generatePsyNote,
  getPsyConfig,
  getPsyNote,
  savePsyNote,
  signPsyNote,
  startPsyNote,
  type Concern,
  type Detection,
  type InputMode,
  type PsyConfig,
  type PsyNote,
  type SafetyAnswer,
} from "../../../../lib/psychotherapyNoteApi";
import { formatDateTime } from "../../shared/format";
import { BTN, BTN_GHOST, BTN_SM, FIELD_LABEL, INPUT } from "../../shared/styles";
import { Callout, ErrorNote, Tag } from "../../shared/ui";
import { errorText } from "../../triage/helpers";
import { AssessmentForm } from "../intake/AssessmentForm";

// Psychotherapy Session note — master prompt §7. Five questions one at a time
// (PSY-WF-04), the mandatory safety question (PSY-S), deterministic organising
// into the seven PSY-OUT sections (X-13), review and sign (PSY-SIGN). Every
// rule is enforced on the server (care_pathway/psychotherapy.py); this screen
// shows what the server says. Drafts live on the server only (X-09) — never in
// browser storage (CLAUDE.md §5).

type Answers = Record<string, { text: string; mode: InputMode }>;

interface SpeechResultList {
  resultIndex: number;
  results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }>;
}
interface SpeechRecognizer {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: ((e: SpeechResultList) => void) | null;
  onend: (() => void) | null;
  onerror: (() => void) | null;
  start: () => void;
  stop: () => void;
}
type SpeechCtor = new () => SpeechRecognizer;

function speechCtor(): SpeechCtor | null {
  const w = window as unknown as { SpeechRecognition?: SpeechCtor; webkitSpeechRecognition?: SpeechCtor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

function toLocalInput(iso: string) {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** The answer text with each PSY-RD trigger highlighted (PSY-RD: highlight the passage). */
function Highlighted({ text, hits }: { text: string; hits: Detection[] }) {
  const parts: ReactNode[] = [];
  let at = 0;
  [...hits].sort((a, b) => a.start - b.start).forEach((h, i) => {
    if (h.start < at) return;
    parts.push(text.slice(at, h.start));
    parts.push(<mark key={i} className="rounded bg-priority-orange-tint px-0.5 text-priority-orange">{text.slice(h.start, h.end)}</mark>);
    at = h.end;
  });
  parts.push(text.slice(at));
  return <p className="whitespace-pre-wrap rounded-md border border-surface-border bg-surface-bg p-2 text-[12.5px]">{parts}</p>;
}

/** Start or resume the clinician's draft for a therapy episode, or open a saved note by id. */
export function PsychotherapySessionNote({ patientId, episodeId, noteId, onClose }: {
  patientId: string;
  episodeId?: string;
  noteId?: string;
  onClose: () => void;
}) {
  const { accessToken } = useAuth();
  const [config, setConfig] = useState<PsyConfig | null>(null);
  const [note, setNote] = useState<PsyNote | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!accessToken) return;
    getPsyConfig(accessToken).then(setConfig).catch((e) => setError(errorText(e, "Couldn't load the session note settings.")));
    const load = noteId ? getPsyNote(accessToken, noteId) : startPsyNote(accessToken, patientId, { episode: episodeId });
    load.then(setNote).catch((e) => setError(errorText(e, "Couldn't open the session note.")));
  }, [accessToken, patientId, episodeId, noteId]);

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-surface-border p-3">
      <div className="flex items-center justify-between gap-2">
        <strong className="text-sm">Psychotherapy session note</strong>
        <button type="button" className={`${BTN_GHOST} ${BTN_SM}`} onClick={onClose}>Close</button>
      </div>
      <ErrorNote>{error}</ErrorNote>
      {!error && (!config || !note) && <p className="text-[13px] text-ink-500">Loading…</p>}
      {config && note && (note.status === "SIGNED"
        ? <SignedNote config={config} note={note} setNote={setNote} />
        : <DraftNote config={config} note={note} setNote={setNote} patientId={patientId} />)}
    </div>
  );
}

function ContextPanel({ note }: { note: PsyNote }) {
  const c = note.context;
  return (
    <details className="rounded-md border border-surface-border p-2 text-[12.5px]" open>
      <summary className="cursor-pointer font-semibold">Context — goals, previous note, risk, safety plan</summary>
      <div className="mt-2 grid grid-cols-1 gap-3 md:grid-cols-2">
        <div>
          <div className={FIELD_LABEL}>Current care-plan goals</div>
          {c.goals.length ? <ul className="ml-4 list-disc">{c.goals.map((g) => <li key={g.index}>{g.goal}</li>)}</ul>
            : <p className="text-ink-500">No goals on the current care plan.</p>}
        </div>
        <div>
          <div className={FIELD_LABEL}>Current risk status</div>
          {c.risk.length ? <ul className="ml-4 list-disc">{c.risk.map((r) => <li key={r.key}>{r.text} <span className="text-ink-500">({r.source})</span></li>)}</ul>
            : <p className="text-ink-500">No active risk items on the record.</p>}
        </div>
        <div>
          <div className={FIELD_LABEL}>Active safety plan</div>
          <p>{c.safety_plan ? `Version ${c.safety_plan.version}, signed ${c.safety_plan.signed_at}` : "No signed safety plan on record."}</p>
        </div>
        <div>
          <div className={FIELD_LABEL}>Previous psychotherapy note</div>
          {!c.previous_note && <p className="text-ink-500">None on record.</p>}
          {c.previous_note?.restricted && <p className="text-ink-500">A previous note exists ({formatDateTime(c.previous_note.at)}) — visible to the care team only.</p>}
          {c.previous_note && !c.previous_note.restricted && (
            <div className="whitespace-pre-wrap">
              <div className="text-ink-500">{formatDateTime(c.previous_note.at)} · {c.previous_note.by}</div>
              {c.previous_note.text ?? `${c.previous_note.plan ?? ""}\n${c.previous_note.risk_safety ?? ""}`}
            </div>
          )}
        </div>
      </div>
    </details>
  );
}

function DraftNote({ config, note, setNote, patientId }: {
  config: PsyConfig; note: PsyNote; setNote: (n: PsyNote) => void; patientId: string;
}) {
  const { accessToken } = useAuth();
  const [answers, setAnswers] = useState<Answers>(note.answers);
  const [step, setStep] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const questions = config.questions;
  const steps = [...questions.map((q) => q.title), "Safety", "Review & sign"];
  const dirty = useRef(false);

  const save = useCallback(async (body: Record<string, unknown>) => {
    if (!accessToken) return false;
    setBusy(true);
    setError(null);
    try {
      const saved = await savePsyNote(accessToken, note.id, body);
      setNote(saved);
      return true;
    } catch (e) {
      setError(errorText(e, "Couldn't save the draft."));
      return false;
    } finally {
      setBusy(false);
    }
  }, [accessToken, note.id, setNote]);

  async function saveAnswers() {
    if (!dirty.current) return true;
    const ok = await save({ answers });
    if (ok) dirty.current = false;
    return ok;
  }
  async function go(to: number) {
    if (await saveAnswers()) setStep(to);
  }
  function setAnswer(key: string, patch: Partial<{ text: string; mode: InputMode }>) {
    dirty.current = true;
    setAnswers((a) => ({ ...a, [key]: { ...(a[key] ?? { text: "", mode: "TYPE" }), ...patch } }));
  }

  return (
    <div className="flex flex-col gap-3">
      <Callout tone="warning" role="status"><strong>{config.watermark}</strong> — saved on the server {formatDateTime(note.draft_saved_at)}.</Callout>
      <ErrorNote>{error}</ErrorNote>
      <ContextPanel note={note} />
      <SessionInfo config={config} note={note} save={save} />
      <ol className="flex flex-wrap gap-1.5" aria-label="Session note steps">
        {steps.map((label, i) => (
          <li key={label}>
            <button type="button" aria-current={i === step ? "step" : undefined} disabled={busy}
              className={`rounded-full border px-2.5 py-0.5 text-[11px] ${i === step ? "border-brand-green bg-brand-green-tint text-brand-green" : "border-surface-border"}`}
              onClick={() => void go(i)}>
              {i + 1}. {i < questions.length ? `Q${i + 1}` : label}
            </button>
          </li>
        ))}
      </ol>
      {step < questions.length && (
        <QuestionStep
          // eslint-disable-next-line security/detect-object-injection -- index within the served list.
          question={questions[step]} index={step} config={config} note={note}
          // eslint-disable-next-line security/detect-object-injection -- question key from the served config.
          answer={answers[questions[step].key] ?? { text: "", mode: "TYPE" }}
          onChange={(p) => setAnswer(questions[step].key, p)}
          save={save}
        />
      )}
      {step === questions.length && <SafetyStep config={config} note={note} save={save} />}
      {step === questions.length + 1 && <ReviewStep key={note.generated_at ?? "not-organised"} config={config} note={note} setNote={setNote} save={save} patientId={patientId} />}
      <div className="flex flex-wrap gap-2">
        {step > 0 && <button type="button" className={`${BTN_GHOST} ${BTN_SM}`} disabled={busy} onClick={() => void go(step - 1)}>Back</button>}
        {step < steps.length - 1 && <button type="button" className={`${BTN} ${BTN_SM}`} disabled={busy} onClick={() => void go(step + 1)}>Save and continue</button>}
        <button type="button" className={`${BTN_GHOST} ${BTN_SM}`} disabled={busy} onClick={() => { dirty.current = true; void saveAnswers(); }}>Save draft</button>
      </div>
    </div>
  );
}

function SessionInfo({ config, note, save }: { config: PsyConfig; note: PsyNote; save: (b: Record<string, unknown>) => Promise<boolean> }) {
  const s = note.session;
  return (
    <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
      <label className="text-[12px]"><span className={FIELD_LABEL}>Session date and time</span>
        <input className={INPUT} type="datetime-local" defaultValue={toLocalInput(s.session_date)}
          onBlur={(e) => e.target.value && void save({ session_date: e.target.value })} />
      </label>
      <label className="text-[12px]"><span className={FIELD_LABEL}>Duration (minutes)</span>
        <input className={INPUT} type="number" min={1} max={600} defaultValue={s.duration_minutes ?? ""}
          onBlur={(e) => void save({ duration_minutes: e.target.value || null })} />
      </label>
      <label className="text-[12px]"><span className={FIELD_LABEL}>Mode</span>
        <select className={INPUT} value={s.attendance_mode} onChange={(e) => void save({ attendance_mode: e.target.value })}>
          <option value="">— not recorded —</option>
          {config.attendance_modes.map((m) => <option key={m.code} value={m.code}>{m.label}</option>)}
        </select>
      </label>
    </div>
  );
}

function QuestionStep({ question, index, config, note, answer, onChange, save }: {
  question: PsyConfig["questions"][number]; index: number; config: PsyConfig; note: PsyNote;
  answer: { text: string; mode: InputMode }; onChange: (p: Partial<{ text: string; mode: InputMode }>) => void;
  save: (b: Record<string, unknown>) => Promise<boolean>;
}) {
  const hits = note.detections.filter((d) => d.question === question.key);
  const flags = note.flags.filter((f) => f.where === question.key);
  const savedText = note.answers[question.key]?.text ?? "";
  return (
    <div className="flex flex-col gap-2">
      <div>
        <div className="text-sm font-semibold">{index + 1}. {question.title}</div>
        <p className="text-[12px] text-ink-500">{question.hint} Answer naturally — no headings or formal language needed.</p>
      </div>
      <div className="flex gap-2" role="radiogroup" aria-label="Input mode">
        {(["TYPE", "SPEAK"] as const).map((m) => (
          <label key={m} className="flex items-center gap-1 text-[12px]">
            <input type="radio" name={`mode-${question.key}`} checked={answer.mode === m} onChange={() => onChange({ mode: m })} />
            {m === "TYPE" ? "Type" : "Speak"}
          </label>
        ))}
      </div>
      {answer.mode === "SPEAK" && <Dictation enabled={config.dictation_enabled} onText={(t) => onChange({ text: answer.text ? `${answer.text} ${t}` : t })} />}
      <textarea className={INPUT} rows={6} aria-label={question.title} value={answer.text} onChange={(e) => onChange({ text: e.target.value })} />
      {question.key === "q3" && (
        <fieldset className="rounded-md border border-surface-border p-2">
          <legend className={FIELD_LABEL}>Therapy model(s) used — only if you used one (optional, any number)</legend>
          <div className="flex flex-wrap gap-3">
            {config.therapy_models.map((m) => (
              <label key={m.code} className="flex items-center gap-1 text-[12px]">
                <input type="checkbox" checked={note.selected_models.includes(m.code)}
                  onChange={(e) => void save({ selected_models: e.target.checked ? [...note.selected_models, m.code] : note.selected_models.filter((c) => c !== m.code) })} />
                {m.name}
              </label>
            ))}
          </div>
        </fieldset>
      )}
      {hits.length > 0 && savedText === answer.text && (
        <Callout tone="warning" role="alert">
          <p className="font-semibold">{config.detection_prompt}</p>
          <Highlighted text={savedText} hits={hits} />
          <p className="mt-1 text-[12px]">Review on the Safety step. This is a prompt only — it is not a risk rating.</p>
        </Callout>
      )}
      {flags.length > 0 && savedText === answer.text && (
        <Callout tone="info">
          {flags.map((f, i) => <p key={i}>“{f.term}” — {f.suggestion}</p>)}
        </Callout>
      )}
    </div>
  );
}

/** X-12: Web Speech API dictation where the organisation allows it; typing otherwise. */
function Dictation({ enabled, onText }: { enabled: boolean; onText: (t: string) => void }) {
  const [listening, setListening] = useState(false);
  const rec = useRef<SpeechRecognizer | null>(null);
  const Ctor = speechCtor();
  useEffect(() => () => rec.current?.stop(), []);
  if (!enabled) return <p className="text-[12px] text-ink-500">Dictation is not enabled for your organisation — type your answer.</p>;
  if (!Ctor) return <p className="text-[12px] text-ink-500">Dictation is not available in this browser — type your answer.</p>;
  function start() {
    if (!Ctor) return;
    const r = new Ctor();
    r.lang = navigator.language || "en";
    r.continuous = true;
    r.interimResults = false;
    r.onresult = (e) => {
      for (let i = e.resultIndex; i < e.results.length; i += 1) {
        // eslint-disable-next-line security/detect-object-injection -- numeric index into the browser's result list.
        const result = e.results[i];
        if (result.isFinal) onText(result[0].transcript.trim());
      }
    };
    r.onend = () => setListening(false);
    r.onerror = () => setListening(false);
    rec.current = r;
    r.start();
    setListening(true);
  }
  return (
    <div className="flex items-center gap-2">
      <button type="button" className={`${BTN_GHOST} ${BTN_SM}`} onClick={() => (listening ? rec.current?.stop() : start())}>
        {listening ? "Stop dictation" : "Start dictation"}
      </button>
      <span className="text-[12px] text-ink-500">Dictated text appears in the box below — check and edit it before saving.</span>
    </div>
  );
}

function SafetyStep({ config, note, save }: { config: PsyConfig; note: PsyNote; save: (b: Record<string, unknown>) => Promise<boolean> }) {
  const [desc, setDesc] = useState(note.safety_detail.description ?? "");
  const [actions, setActions] = useState(note.safety_detail.actions ?? "");
  const [ack, setAck] = useState("");
  const [review, setReview] = useState<Record<string, string>>({});
  const concerns = note.safety_detail.concerns ?? [];
  const has = (c: Concern) => concerns.some((x) => JSON.stringify(x) === JSON.stringify(c));
  const toggle = (c: Concern, on: boolean) => {
    const next = on ? [...concerns, c] : concerns.filter((x) => JSON.stringify(x) !== JSON.stringify(c));
    void save({ safety_detail: { concerns: next, description: desc, actions } });
  };
  const answer = (note.safety_answer ?? "") as SafetyAnswer;
  return (
    <div className="flex flex-col gap-2">
      <fieldset>
        <legend className="text-sm font-semibold">Safety (mandatory every session)</legend>
        <p className="text-[13px]">{config.safety_question}</p>
        <div className="mt-1 flex gap-3">
          {config.safety_options.map((o) => (
            <label key={o.code} className="flex items-center gap-1 text-[13px]">
              <input type="radio" name="safety" checked={answer === o.code} onChange={() => void save({ safety_answer: o.code })} /> {o.label}
            </label>
          ))}
        </div>
      </fieldset>
      {answer === "YES" && (
        <div className="flex flex-col gap-2 rounded-md border border-priority-red p-2">
          <Callout tone="danger" role="alert">A safety concern alert is on the client record. Each risk-register concern you tick is queued on the risk register for review — complete the appropriate risk assessment and review the safety plan.</Callout>
          {config.concerns.register.map((r) => (
            <div key={r.row}>
              <div className={FIELD_LABEL}>{r.label}</div>
              <div className="flex flex-wrap gap-3">
                {r.options.map((o) => (
                  <label key={o} className="flex items-center gap-1 text-[12px]">
                    <input type="checkbox" checked={has({ row: r.row, option: o })} onChange={(e) => toggle({ row: r.row, option: o }, e.target.checked)} /> {o}
                  </label>
                ))}
              </div>
            </div>
          ))}
          <div className="flex flex-wrap gap-3">
            {config.concerns.other.map((o) => (
              <label key={o.code} className="flex items-center gap-1 text-[12px]">
                <input type="checkbox" checked={has({ other: o.code })} onChange={(e) => toggle({ other: o.code }, e.target.checked)} /> {o.label}
              </label>
            ))}
          </div>
          <textarea className={INPUT} rows={2} aria-label="Describe the concern" placeholder="Describe the concern (required)" value={desc} onChange={(e) => setDesc(e.target.value)}
            onBlur={() => void save({ safety_detail: { concerns, description: desc, actions } })} />
          <textarea className={INPUT} rows={2} aria-label="Actions taken" placeholder="Actions taken" value={actions} onChange={(e) => setActions(e.target.value)}
            onBlur={() => void save({ safety_detail: { concerns, description: desc, actions } })} />
        </div>
      )}
      {answer === "NOT_ASSESSED" && (
        note.safety_ack ? <Callout tone="info">Acknowledged by {note.safety_ack.by}: {note.safety_ack.reason}</Callout> : (
          <div className="flex flex-col gap-1">
            <Callout tone="warning" role="alert">Safety not assessed — this note cannot be signed until you acknowledge it and give the reason.</Callout>
            <textarea className={INPUT} rows={2} aria-label="Reason safety was not assessed" value={ack} onChange={(e) => setAck(e.target.value)} />
            <div><button type="button" className={`${BTN} ${BTN_SM}`} disabled={ack.trim().length < 3} onClick={() => void save({ acknowledge_not_assessed: { reason: ack } })}>Acknowledge</button></div>
          </div>
        )
      )}
      {note.detections.length > 0 && (
        <div className="flex flex-col gap-2">
          <Callout tone="warning" role="alert">
            <p className="font-semibold">{config.detection_prompt}</p>
            {answer === "NO" && <p>Your safety answer is No — review each passage: change the answer, or record what your review found.</p>}
          </Callout>
          {note.detections.map((d) => (
            <div key={d.key} className="rounded-md border border-surface-border p-2 text-[12.5px]">
              <div className="text-ink-500">Q{d.question.slice(1)}</div>
              <Highlighted text={d.passage} hits={[{ ...d, start: d.passage.toLowerCase().indexOf(d.matched.toLowerCase()), end: d.passage.toLowerCase().indexOf(d.matched.toLowerCase()) + d.matched.length }]} />
              {d.resolution ? <p className="mt-1">Reviewed by {d.resolution.by}: {d.resolution.reason}</p> : (
                <div className="mt-1 flex gap-2">
                  <input className={INPUT} aria-label="What your review found" placeholder="What your review found"
                    value={review[d.key] ?? ""} onChange={(e) => setReview((r) => ({ ...r, [d.key]: e.target.value }))} />
                  <button type="button" className={`${BTN_GHOST} ${BTN_SM}`}
                    disabled={(review[d.key] ?? "").trim().length < 3}
                    onClick={() => void save({ resolve_detection: { key: d.key, reason: review[d.key] } })}>Record review</button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function ReviewStep({ config, note, setNote, save, patientId }: {
  config: PsyConfig; note: PsyNote; setNote: (n: PsyNote) => void;
  save: (b: Record<string, unknown>) => Promise<boolean>; patientId: string;
}) {
  const { accessToken } = useAuth();
  const [sections, setSections] = useState<Record<string, string>>(note.sections);
  const [statements, setStatements] = useState<Record<number, string>>({});
  const [process, setProcess] = useState(note.session.process_notes ?? "");
  const [defs, setDefs] = useState<InstrumentDef[]>([]);
  const [instrument, setInstrument] = useState("");
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (accessToken) getInstruments(accessToken).then((r) => setDefs(r.results.filter((d) => !d.withdrawal))).catch(() => undefined);
  }, [accessToken]);
  const def = defs.find((d) => d.code === instrument);

  async function run(work: (t: string) => Promise<PsyNote>) {
    if (!accessToken) return;
    setError(null);
    try {
      setNote(await work(accessToken));
    } catch (e) {
      setError(errorText(e, "Couldn't complete that."));
    }
  }
  const edited = Object.keys(sections).some((k) => sections[k] !== note.sections[k]);

  return (
    <div className="flex flex-col gap-3">
      <ErrorNote>{error}</ErrorNote>
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" className={`${BTN} ${BTN_SM}`}
          onClick={() => (!note.sections_edited || window.confirm("Organising again replaces your edits to the sections. Continue?")) && void run((t) => generatePsyNote(t, note.id))}>
          {note.generated_at ? "Organise again from the answers" : "Organise into a note"}
        </button>
        {note.generated_at && <Tag tone="warn">{config.watermark}</Tag>}
        {!note.generated_at && Object.keys(note.sections).length > 0 && <Tag tone="warn">Answers changed — organise again before signing</Tag>}
      </div>
      {note.goal_suggestions.map((g) => (
        <div key={g.goal_index} className="rounded-md border border-surface-border p-2 text-[12.5px]">
          <p>Possible progress toward the goal <strong>“{g.goal}”</strong>: “{g.evidence}”</p>
          <textarea className={`${INPUT} mt-1`} rows={2} aria-label="Progress statement" placeholder="Write the progress statement you confirm"
            value={statements[g.goal_index] ?? ""} onChange={(e) => setStatements((s) => ({ ...s, [g.goal_index]: e.target.value }))} />
          <div className="mt-1 flex gap-2">
            <button type="button" className={`${BTN} ${BTN_SM}`} disabled={!(statements[g.goal_index] ?? "").trim()}
              onClick={() => void save({ goal_link: { goal_index: g.goal_index, decision: "CONFIRMED", statement: statements[g.goal_index] } })}>Confirm</button>
            <button type="button" className={`${BTN_GHOST} ${BTN_SM}`} onClick={() => void save({ goal_link: { goal_index: g.goal_index, decision: "DISMISSED" } })}>Not progress</button>
          </div>
        </div>
      ))}
      {note.generated_at && config.sections.map((s) => (
        <label key={s.key} className="flex flex-col gap-1">
          <span className={FIELD_LABEL}>{s.title}</span>
          <textarea className={INPUT} rows={Math.min(10, Math.max(3, (sections[s.key] ?? "").split("\n").length + 1))}
            value={sections[s.key] ?? ""} onChange={(e) => setSections((x) => ({ ...x, [s.key]: e.target.value }))} />
          {note.flags.filter((f) => f.where === `section:${s.key}`).map((f, i) => <span key={i} className="text-[12px] text-priority-orange">“{f.term}” — {f.suggestion}</span>)}
        </label>
      ))}
      {note.generated_at && edited && <div><button type="button" className={`${BTN_GHOST} ${BTN_SM}`} onClick={() => void save({ sections })}>Save section edits</button></div>}
      <div className="flex flex-wrap items-center gap-2">
        <select className={`${INPUT} max-w-xs`} aria-label="Measurement-based care instrument" value={instrument} onChange={(e) => setInstrument(e.target.value)}>
          <option value="">Measurement-based care — none this session</option>
          {defs.map((d) => <option key={d.code} value={d.code}>{d.name}</option>)}
        </select>
        {note.session.measure && <Tag tone="brand">{note.session.measure.name} {note.session.measure.total} — in the outcome store</Tag>}
      </div>
      {def && (
        <AssessmentForm patientId={patientId} def={def} context="THERAPY" hasPrevious
          onSaved={(s) => { setInstrument(""); void save({ score_id: s.id }); }} onCancel={() => setInstrument("")} />
      )}
      {note.session.process_notes !== null && (
        <label className="flex flex-col gap-1">
          <span className={FIELD_LABEL}>Process notes — restricted (never shared with billing or payers)</span>
          <textarea className={INPUT} rows={2} value={process} onChange={(e) => setProcess(e.target.value)} onBlur={() => process !== (note.session.process_notes ?? "") && void save({ process_notes: process })} />
        </label>
      )}
      {note.blockers.length > 0 && (
        <Callout tone="warning">
          <p className="font-semibold">Before signing:</p>
          <ul className="ml-4 list-disc">{note.blockers.map((b) => <li key={b.code}>{b.text}</li>)}</ul>
        </Callout>
      )}
      <label className="flex items-center gap-2 text-[13px]">
        <input type="checkbox" checked={note.accuracy_confirmed} disabled={!note.generated_at || edited}
          onChange={(e) => void save({ accuracy_confirmed: e.target.checked })} />
        I have reviewed this note and it is an accurate record of the session
      </label>
      <div>
        <button type="button" className={`${BTN} ${BTN_SM}`} disabled={note.blockers.length > 0 || edited}
          onClick={() => void run((t) => signPsyNote(t, note.id))}>Sign note</button>
      </div>
    </div>
  );
}

function SignedNote({ config, note, setNote }: { config: PsyConfig; note: PsyNote; setNote: (n: PsyNote) => void }) {
  const { accessToken } = useAuth();
  const [amending, setAmending] = useState<string | null>(null);
  const [text, setText] = useState("");
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  async function submit() {
    if (!accessToken || !amending) return;
    setError(null);
    try {
      setNote(await amendPsyNote(accessToken, note.id, { section: amending, text, reason }));
      setAmending(null);
    } catch (e) {
      setError(errorText(e, "Couldn't save the amendment."));
    }
  }
  return (
    <div className="flex flex-col gap-2">
      <Callout tone="success">Signed by {note.author} · {formatDateTime(note.signed_at)}. A signed note is not edited — changes are audited amendments.</Callout>
      <ErrorNote>{error}</ErrorNote>
      {config.sections.map((s) => (
        <section key={s.key} className="rounded-md border border-surface-border p-2">
          <div className="flex items-center justify-between">
            <span className={FIELD_LABEL}>{s.title}</span>
            {amending !== s.key && <button type="button" className={`${BTN_GHOST} ${BTN_SM}`} onClick={() => { setAmending(s.key); setText(note.sections[s.key] ?? ""); setReason(""); }}>Amend</button>}
          </div>
          {amending === s.key ? (
            <div className="mt-1 flex flex-col gap-1">
              <textarea className={INPUT} rows={4} aria-label={`Amended ${s.title}`} value={text} onChange={(e) => setText(e.target.value)} />
              <input className={INPUT} aria-label="Reason for amendment" placeholder="Reason for the amendment (required)" value={reason} onChange={(e) => setReason(e.target.value)} />
              <div className="flex gap-2">
                <button type="button" className={`${BTN} ${BTN_SM}`} disabled={reason.trim().length < 3} onClick={() => void submit()}>Save amendment</button>
                <button type="button" className={`${BTN_GHOST} ${BTN_SM}`} onClick={() => setAmending(null)}>Cancel</button>
              </div>
            </div>
          ) : <p className="mt-1 whitespace-pre-wrap text-[12.5px]">{note.sections[s.key]}</p>}
        </section>
      ))}
      {note.amendments.length > 0 && (
        <details className="text-[12.5px]">
          <summary className="cursor-pointer font-semibold">Amendment trail ({note.amendments.length})</summary>
          {note.amendments.map((a) => (
            <div key={a.id} className="mt-1 rounded-md border border-surface-border p-2">
              <div className="text-ink-500">{formatDateTime(a.at)} · {a.by} · {config.sections.find((s) => s.key === a.section)?.title} — {a.reason}</div>
              <div className="whitespace-pre-wrap line-through opacity-70">{a.previous_text}</div>
              <div className="whitespace-pre-wrap">{a.new_text}</div>
            </div>
          ))}
        </details>
      )}
    </div>
  );
}
