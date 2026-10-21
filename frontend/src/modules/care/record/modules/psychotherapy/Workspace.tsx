import {
  ArrowLeft,
  ArrowUp,
  ChevronDown,
  Clock,
  FileText,
  Keyboard,
  Layers,
  Maximize2,
  MessageSquare,
  Mic,
  Minimize2,
  Minus,
  Plus,
  User,
  X,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { useAuth } from "../../../../../auth/useAuth";
import { useDialogA11y } from "../../../../../components/useDialogA11y";
import { getInstruments, type InstrumentDef } from "../../../../../lib/carePathwayApi";
import {
  amendPsyNote,
  generatePsyNote,
  getPsyConfig,
  getPsyNote,
  listPsyNotes,
  savePsyNote,
  signPsyNote,
  startPsyNote,
  type GoalDecision,
  type PsyConfig,
  type PsyNote,
  type PsyNoteSummary,
  type SafetyAnswer,
} from "../../../../../lib/psychotherapyNoteApi";
import { BTN_GHOST, BTN_SM, FIELD_LABEL, INPUT } from "../../../shared/styles";
import { ErrorNote, Tag } from "../../../shared/ui";
import { errorText } from "../../../triage/helpers";
import { AssessmentForm } from "../../intake/AssessmentForm";
import { Composer, ModeMenu, type DictationState, type InputChoice } from "./Composer";
import {
  answerText,
  currentStep,
  ddmmyyyy,
  parseDdMmYyyy,
  QUESTION_COUNT,
  readPref,
  REVIEW_STEP,
  SAFETY_STEP,
  speechLang,
  stepLabel,
  stepStatus,
  withDate,
  writePref,
} from "./helpers";
import { NotePanel } from "./NotePanel";
import { ApproachesDialog, AuditTrail, ClientFile, PastNote, SessionHistory } from "./RailViews";
import { SafetyModal } from "./SafetyModal";
import { safetyFromSpeech, speak, stopSpeaking, synthesisAvailable, useDictation } from "./speech";
import { ExampleThread, Thread, type Ack } from "./Thread";

// Psychotherapy session workspace — the chat layout from the client's mockup:
// icon rail | guided conversation | therapy note. Every rule (detection, goal
// suggestions, the sign-off checklist, AI assistance) is the server's
// (care_pathway/psychotherapy.py); this screen asks, shows and sends.
// Clinical content lives on the server draft only (X-09) — never in browser
// storage (CLAUDE.md §5). Only UI preferences (panel width, answer mode,
// language, read-aloud) are remembered locally.

type View = "chat" | "history" | "past" | "client" | "audit";
type PanelState = "open" | "expanded" | "min" | "closed";

const WIDE = "(min-width: 1100px)";
const MIN_WIDTH = 320;
const STEP_COUNT = REVIEW_STEP + 1;

function useMedia(query: string) {
  const [match, setMatch] = useState(() => window.matchMedia(query).matches);
  useEffect(() => {
    const m = window.matchMedia(query);
    const on = () => setMatch(m.matches);
    m.addEventListener("change", on);
    return () => m.removeEventListener("change", on);
  }, [query]);
  return match;
}

const join = (...parts: string[]) => parts.map((p) => p.trim()).filter(Boolean).join(" ");
const maxWidth = () => Math.max(MIN_WIDTH, window.innerWidth - 64 - 380);
const clampWidth = (w: number) => Math.min(Math.max(MIN_WIDTH, w), maxWidth());
const ttsLang = (code: string) => (code.startsWith("en") ? code : "en-GB");

function started(note: PsyNote) {
  return note.status === "SIGNED" || !!note.safety_answer ||
    Object.values(note.answers).some((a) => a?.text?.trim());
}

/** Start or resume the clinician's draft for a therapy episode, or open a saved
 * note by id — as a full-screen workspace over the page it was opened from. */
export function PsychotherapyWorkspace({ patientId, episodeId, noteId, onClose }: {
  patientId: string;
  episodeId?: string;
  noteId?: string;
  onClose: () => void;
}) {
  const { accessToken } = useAuth();
  const [config, setConfig] = useState<PsyConfig | null>(null);
  const [note, setNote] = useState<PsyNote | null>(null);
  const [error, setError] = useState<string | null>(null);
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!accessToken) return;
    getPsyConfig(accessToken).then(setConfig).catch((e) => setError(errorText(e, "Couldn't load the session note settings.")));
    const load = noteId ? getPsyNote(accessToken, noteId) : startPsyNote(accessToken, patientId, { episode: episodeId });
    load.then(setNote).catch((e) => setError(errorText(e, "Couldn't open the session note.")));
  }, [accessToken, patientId, episodeId, noteId]);
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    root.current?.focus();
    return () => {
      document.body.style.overflow = overflow;
      stopSpeaking();
      opener?.focus?.();
    };
  }, []);
  return createPortal(
    <div ref={root} tabIndex={-1} role="dialog" aria-modal="true" aria-label="Psychotherapy session"
      className="fixed inset-0 z-[100] flex bg-surface-bg text-ink-900 outline-none">
      {config && note ? (
        <WorkspaceBody key={note.id} config={config} initial={note} patientId={patientId} onClose={onClose}
          onReplace={setNote} />
      ) : (
        <div className="m-auto flex max-w-md flex-col items-center gap-3 p-6 text-center">
          <ErrorNote>{error}</ErrorNote>
          {!error && <p className="text-[13px] text-ink-500">Loading the session…</p>}
          <button type="button" className={BTN_GHOST} onClick={onClose}>Close</button>
        </div>
      )}
    </div>,
    document.body,
  );
}

function RailButton({ label, current, onClick, children }: { label: string; current?: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button type="button" aria-label={label} title={label} aria-current={current ? "page" : undefined} onClick={onClick}
      className={`flex h-10 w-10 items-center justify-center rounded-[10px] transition-colors ${current ? "bg-brand-green-tint text-brand-green" : "text-ink-700 hover:bg-surface-bg"}`}>
      {children}
    </button>
  );
}

function StepMenu({ config, note, step, signed, onJump }: {
  config: PsyConfig; note: PsyNote; step: number; signed: boolean; onJump: (i: number) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLLIElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      setOpen(false);
      button.current?.focus();
    };
    const onClick = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && setOpen(false);
    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onClick);
    ref.current?.querySelector<HTMLElement>("[role=menuitem]:not(:disabled)")?.focus();
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onClick);
    };
  }, [open]);
  const label = signed ? "Signed" : step < QUESTION_COUNT ? `Question ${step + 1} of ${QUESTION_COUNT}` : stepLabel(config, step);
  const short = signed ? "Signed" : step < QUESTION_COUNT ? `Q${step + 1} of ${QUESTION_COUNT}` : stepLabel(config, step);
  return (
    <li ref={ref} className="relative flex items-center">
      <button ref={button} type="button" aria-haspopup="menu" aria-expanded={open} aria-current="step" onClick={() => setOpen((o) => !o)}
        className="inline-flex items-center gap-1 whitespace-nowrap rounded-md px-1.5 py-0.5 font-semibold text-ink-900 hover:bg-surface-bg">
        <span className="hidden sm:inline">{label}</span><span className="sm:hidden">{short}</span>
        <ChevronDown className="h-3.5 w-3.5" />
      </button>
      {open && (
        <div role="menu" aria-label="Jump to step" className="absolute left-0 top-full z-30 mt-1 w-[min(320px,calc(100vw-32px))] rounded-lg border border-surface-border bg-surface-card p-1 shadow-md">
          {Array.from({ length: STEP_COUNT }, (_, i) => {
            const status = signed && i === REVIEW_STEP ? "Done" : stepStatus(note, config, i, signed ? -1 : step);
            const tone = status === "Done" ? "text-brand-green" : status === "Needs review" ? "text-priority-red" : status === "Current" ? "text-ink-900" : "text-ink-500";
            return (
              <button key={i} type="button" role="menuitem" disabled={status === "Not yet"} onClick={() => { setOpen(false); onJump(i); }}
                className="flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-[12.5px] hover:bg-surface-bg disabled:cursor-not-allowed disabled:opacity-50">
                <span className="w-6 font-mono text-[11px] text-ink-500">{i < QUESTION_COUNT ? `Q${i + 1}` : i === SAFETY_STEP ? "S" : "✓"}</span>
                {/* eslint-disable-next-line security/detect-object-injection -- index within the served question list. */}
                <span className="min-w-0 flex-1 truncate">{i < QUESTION_COUNT ? config.questions[i]?.title : stepLabel(config, i)}</span>
                <span className={`text-[11px] font-semibold ${tone}`}>{status}</span>
              </button>
            );
          })}
        </div>
      )}
    </li>
  );
}

/** Measurement-based care score and restricted process notes for this session. */
function SessionExtras({ note, patientId, save }: { note: PsyNote; patientId: string; save: (b: Record<string, unknown>) => Promise<boolean> }) {
  const { accessToken } = useAuth();
  const [defs, setDefs] = useState<InstrumentDef[]>([]);
  const [instrument, setInstrument] = useState("");
  const [process, setProcess] = useState(note.session.process_notes ?? "");
  useEffect(() => {
    if (accessToken) getInstruments(accessToken).then((r) => setDefs(r.results.filter((d) => !d.withdrawal))).catch(() => undefined);
  }, [accessToken]);
  const def = defs.find((d) => d.code === instrument);
  return (
    <div className="mt-3 flex flex-col gap-2 rounded-lg border border-surface-border p-3">
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
          <textarea className={INPUT} rows={2} value={process} onChange={(e) => setProcess(e.target.value)}
            onBlur={() => process !== (note.session.process_notes ?? "") && void save({ process_notes: process })} />
        </label>
      )}
    </div>
  );
}

function WorkspaceBody({ config, initial, patientId, onClose, onReplace }: {
  config: PsyConfig;
  initial: PsyNote;
  patientId: string;
  onClose: () => void;
  onReplace: (n: PsyNote) => void;
}) {
  const { accessToken } = useAuth();
  const wide = useMedia(WIDE);
  const [note, setNote] = useState(initial);
  const signed = note.status === "SIGNED";
  const locked = signed || !note.is_author;
  const [begun, setBegun] = useState(() => started(initial));
  const [step, setStep] = useState(() => (initial.status === "SIGNED" ? REVIEW_STEP : started(initial) ? currentStep(initial, config) : 0));
  const [awaitingReason, setAwaitingReason] = useState(() => initial.safety_answer === "NOT_ASSESSED" && !initial.not_assessed_reason);
  const [acks, setAcks] = useState<Ack[]>([]);
  const [editKey, setEditKey] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [focusSignal, setFocusSignal] = useState(1);
  const [example, setExample] = useState(false);
  const [view, setView] = useState<View>("chat");
  const [pastId, setPastId] = useState<string | null>(null);
  const [notes, setNotes] = useState<PsyNoteSummary[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState("");
  const [safetyOpen, setSafetyOpen] = useState(false);
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [panel, setPanel] = useState<PanelState>("open");
  const [notesOpen, setNotesOpen] = useState(false);
  const [full, setFull] = useState(false);
  const [width, setWidth] = useState(() => clampWidth(Number(readPref("noteWidth")) || 420));
  const [mode, setModeState] = useState<InputChoice>(() => (config.dictation_enabled && readPref("mode") === "dictate" ? "dictate" : "type"));
  const [language, setLanguageState] = useState(() => {
    const saved = readPref("language");
    return config.languages.some((l) => l.code === saved) ? (saved as string) : "en-GB";
  });
  // Read-aloud (on-device speech synthesis) is always offered; unless the
  // clinician has chosen, it is on when dictating and off when typing.
  const [voice, setVoiceState] = useState(() => {
    const saved = readPref("voice");
    return saved ? saved === "on" : config.dictation_enabled && readPref("mode") === "dictate";
  });
  const [speaking, setSpeaking] = useState(false);
  const [dateText, setDateText] = useState(() => ddmmyyyy(initial.session.session_date));
  const [dateError, setDateError] = useState("");
  const scroller = useRef<HTMLDivElement>(null);
  const afterSafetyModal = useRef(false);
  const organisedOnce = useRef(false);

  const flash = useCallback((text: string) => {
    setToast(text);
    window.setTimeout(() => setToast((t) => (t === text ? "" : t)), 2600);
  }, []);
  const addAck = (anchor: string, text: string) => setAcks((a) => [...a, { anchor, text }]);
  const scrollDown = () => window.requestAnimationFrame(() => {
    const s = scroller.current;
    if (s) s.scrollTop = s.scrollHeight;
  });

  const save = useCallback(async (body: Record<string, unknown>) => {
    if (!accessToken) return false;
    setBusy(true);
    setError(null);
    try {
      setNote(await savePsyNote(accessToken, note.id, body));
      return true;
    } catch (e) {
      setError(errorText(e, "Couldn't save — your words are still in the box. Check the connection and try again."));
      return false;
    } finally {
      setBusy(false);
    }
  }, [accessToken, note.id]);

  async function run(work: (t: string) => Promise<PsyNote>, fallback: string) {
    if (!accessToken) return false;
    setBusy(true);
    setError(null);
    try {
      setNote(await work(accessToken));
      return true;
    } catch (e) {
      setError(errorText(e, fallback));
      return false;
    } finally {
      setBusy(false);
    }
  }
  const organise = () => run((t) => generatePsyNote(t, note.id), "Couldn't organise the note.");
  const sign = async () => {
    const ok = await run((t) => signPsyNote(t, note.id), "Couldn't sign the note.");
    if (ok) flash("Note signed");
    return ok;
  };
  const amend = async (body: { section: string; text: string; reason: string }) => {
    if (!accessToken) return false;
    try {
      await amendPsyNote(accessToken, note.id, body);
      setNote(await getPsyNote(accessToken, note.id));
      flash("Amendment added");
      return true;
    } catch (e) {
      setError(errorText(e, "Couldn't add the amendment."));
      return false;
    }
  };

  // Translation / rewording run in the background on the server: refresh while pending.
  const pending = note.processing.status === "pending" || note.transcript.some((t) => t.translation?.status === "pending");
  useEffect(() => {
    if (!pending || !accessToken) return;
    const timer = window.setTimeout(() => {
      getPsyNote(accessToken, note.id).then(setNote).catch(() => undefined);
    }, 4000);
    return () => window.clearTimeout(timer);
  }, [pending, note, accessToken]);

  // The note builds as the clinician goes: rule-based organising is immediate,
  // so it reruns whenever the answers change. With AI assistance on (each
  // organise queues a rewording) it runs once on reaching the review step, and
  // later changes show "Update note". A failed organise is not retried here.
  const autoFailed = useRef(false);
  useEffect(() => {
    if (example || busy || !begun || note.status !== "DRAFT" || !note.is_author || note.generated_at || autoFailed.current) return;
    const live = !config.ai_enabled && Object.values(note.answers).some((a) => a?.text?.trim());
    const atReview = step >= REVIEW_STEP && !organisedOnce.current;
    if (!live && !atReview) return;
    if (atReview) organisedOnce.current = true;
    void organise().then((ok) => {
      if (!ok) autoFailed.current = true;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reruns on the note's organise state, not on every render.
  }, [note.generated_at, note.status, busy, step, example, begun]);

  useEffect(() => {
    if (!accessToken || (view !== "history" && view !== "client")) return;
    listPsyNotes(accessToken, patientId).then((r) => setNotes(r.results)).catch(() => setNotes([]));
  }, [accessToken, patientId, view]);

  // ── speech ──
  const safetyListening = step === SAFETY_STEP && !awaitingReason && !editKey;
  const dict = useDictation(speechLang(language), safetyListening, {
    onCommit: (text) => void submit(join(draft, text), "DICTATED"),
    onRepeat: () => repeatQuestion(),
    onSafety: (answer) => void chooseSafety(answer),
  });
  const dictRef = useRef(dict);
  useEffect(() => {
    dictRef.current = dict;
  });

  function speakThen(text: string, listen: boolean, force = false) {
    const go = () => {
      setSpeaking(false);
      if (listen) window.setTimeout(() => dictRef.current.start(), 250);
    };
    if ((voice || force) && synthesisAvailable()) {
      setSpeaking(true);
      speak(text, ttsLang(language), go);
    } else go();
  }

  function announce(i: number, opts: { prefix?: string; force?: boolean } = {}) {
    const listen = mode === "dictate" && config.dictation_enabled && i <= SAFETY_STEP;
    // eslint-disable-next-line security/detect-object-injection -- index within the served question list.
    const text = i < QUESTION_COUNT ? config.questions[i]?.title ?? ""
      : i === SAFETY_STEP ? `Safety question. ${config.safety_question} Please answer yes, no, or not assessed.`
        : "Thank you. Your draft note is ready for review.";
    setFocusSignal((n) => n + 1);
    if (!listen && !voice && !opts.force) return;
    speakThen(join(opts.prefix ?? "", text), listen, opts.force);
  }

  function quiet() {
    dictRef.current.stop();
    dictRef.current.reset();
    stopSpeaking();
    setSpeaking(false);
  }

  /** Read the current question again, keeping what was dictated so far. */
  function repeatQuestion() {
    setDraft((d) => join(d, dictRef.current.finalText));
    quiet();
    announce(step, { force: true });
  }

  function setMode(m: InputChoice) {
    quiet();
    setModeState(m);
    writePref("mode", m);
    if (!readPref("voice")) setVoiceState(m === "dictate");
  }
  function setLanguage(code: string) {
    quiet();
    setLanguageState(code);
    writePref("language", code);
  }
  function setVoice(on: boolean) {
    if (!on) stopSpeaking();
    setVoiceState(on);
    writePref("voice", on ? "on" : "off");
  }

  // ── conversation ──
  function goReview() {
    setStep(REVIEW_STEP);
    if (wide && panel !== "expanded") setPanel("open");
    announce(REVIEW_STEP);
    scrollDown();
  }

  function begin() {
    const parsed = parseDdMmYyyy(dateText);
    if ("error" in parsed) {
      setDateError("Enter the session date as dd/mm/yyyy before you begin.");
      return false;
    }
    setBegun(true);
    setStep(0);
    announce(0);
    return true;
  }

  async function commitDate() {
    const parsed = parseDdMmYyyy(dateText);
    if ("error" in parsed) {
      setDateError(parsed.error);
      return;
    }
    setDateError("");
    const when = withDate(note.session.session_date, parsed.date);
    setDateText(ddmmyyyy(when));
    if (ddmmyyyy(when) !== ddmmyyyy(note.session.session_date)) await save({ session_date: when });
  }

  async function submit(raw: string, via: "TYPED" | "DICTATED") {
    const text = raw.trim();
    if (!text || locked) return false;
    quiet();
    let at = step;
    if (!begun) {
      if (!begin()) return false;
      at = 0;
    }
    if (awaitingReason) {
      if (!(await save({ not_assessed_reason: text }))) return false;
      setDraft("");
      setAwaitingReason(false);
      addAck("safety", "Noted. This stays flagged for your review before signing.");
      goReview();
      return true;
    }
    if (editKey) {
      const key = editKey;
      if (!(await save({ answers: { [key]: { text, mode: via, language } } }))) return false;
      setDraft("");
      setEditKey(null);
      flash(`Answer to Q${config.questions.findIndex((q) => q.key === key) + 1} updated`);
      return true;
    }
    if (at < QUESTION_COUNT) {
      // eslint-disable-next-line security/detect-object-injection -- index within the served question list.
      const key = config.questions[at].key;
      if (!accessToken) return false;
      setBusy(true);
      setError(null);
      let saved: PsyNote;
      try {
        saved = await savePsyNote(accessToken, note.id, { answers: { [key]: { text, mode: via, language } } });
      } catch (e) {
        setError(errorText(e, "Couldn't save — your words are still in the box. Check the connection and try again."));
        return false;
      } finally {
        setBusy(false);
      }
      setNote(saved);
      setDraft("");
      const flagged = saved.detections.some((d) => d.question === key && !d.resolution);
      const next = at + 1;
      setStep(next);
      announce(next, { prefix: flagged ? `Thank you. ${config.detection_prompt}` : "Thank you." });
      scrollDown();
      return true;
    }
    if (at === SAFETY_STEP) {
      const answer = safetyFromSpeech(text);
      setDraft("");
      if (answer) return chooseSafety(answer);
      addAck("safety", "Please choose Yes, No or Not assessed for the safety question.");
      scrollDown();
      return false;
    }
    setDraft("");
    addAck("review", "The questions are complete. To change an answer, use Edit under it, or edit the note directly.");
    scrollDown();
    return false;
  }

  async function chooseSafety(answer: Exclude<SafetyAnswer, "">) {
    quiet();
    const first = !note.safety_answer;
    if (answer !== note.safety_answer && !(await save({ safety_answer: answer }))) return false;
    const atSafety = step === SAFETY_STEP && first;
    if (answer === "YES") {
      if (atSafety) addAck("safety", "Concern flagged. Please record what you assessed in the risk workflow.");
      afterSafetyModal.current = atSafety;
      if (!note.safety_detail.risk_link || atSafety) setSafetyOpen(true);
      if (mode === "dictate" && atSafety) speakThen("Concern flagged. Please complete the risk details on screen.", false);
    } else if (answer === "NOT_ASSESSED") {
      setAwaitingReason(true);
      const ask = "Understood. Briefly, why was safety not assessed today?";
      addAck("safety", ask);
      setFocusSignal((n) => n + 1);
      if (mode === "dictate" && config.dictation_enabled) speakThen(ask, true);
    } else {
      setAwaitingReason(false);
      if (atSafety && note.detections.some((d) => !d.resolution)) {
        addAck("safety", "Recorded as no new or changed concern. Earlier answers include flagged language; please confirm it during review.");
      }
      if (atSafety) goReview();
    }
    scrollDown();
    return true;
  }

  function closeSafety() {
    setSafetyOpen(false);
    if (afterSafetyModal.current) {
      afterSafetyModal.current = false;
      goReview();
    }
  }

  function editAnswer(key: string) {
    quiet();
    setView("chat");
    setEditKey(key);
    setDraft(answerText(note, key));
    setFocusSignal((n) => n + 1);
  }

  function jump(i: number) {
    setView("chat");
    if (i === REVIEW_STEP) {
      openNotes();
      return;
    }
    window.requestAnimationFrame(() => {
      const el = document.getElementById(i < QUESTION_COUNT ? `psy-m-q${i}` : "psy-m-safety");
      el?.scrollIntoView({ block: "start", behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
    });
  }

  function openNotes() {
    if (wide) {
      if (panel !== "expanded") setPanel("open");
    } else setNotesOpen(true);
  }

  async function newSession() {
    quiet();
    setView("chat");
    if (!signed) {
      flash(begun ? "Sign this session first — there is one open draft per therapy episode." : `Session ${note.session_number ?? ""} is ready to begin`);
      return;
    }
    if (!accessToken) return;
    try {
      onReplace(await startPsyNote(accessToken, patientId, { episode: note.therapy_episode || undefined }));
    } catch (e) {
      setError(errorText(e, "Couldn't start a new session."));
    }
  }

  // ── panel resizing (drag or arrow keys) ──
  function startDrag(e: ReactPointerEvent<HTMLDivElement>) {
    e.preventDefault();
    const move = (ev: PointerEvent) => setWidth(clampWidth(window.innerWidth - ev.clientX));
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      setWidth((w) => {
        writePref("noteWidth", String(w));
        return w;
      });
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  }
  function resizeKey(e: ReactKeyboardEvent<HTMLDivElement>) {
    const delta = e.key === "ArrowLeft" ? 24 : e.key === "ArrowRight" ? -24 : 0;
    if (!delta) return;
    e.preventDefault();
    const next = clampWidth(width + delta);
    setWidth(next);
    writePref("noteWidth", String(next));
  }

  const slideOver = useDialogA11y<HTMLElement>(!wide && notesOpen, () => setNotesOpen(false));

  // ── layout pieces ──
  const flags = note.detections.filter((d) => !d.resolution);
  const segments = Array.from({ length: STEP_COUNT }, (_, i) => {
    const status = signed ? "Done" : stepStatus(note, config, i, begun ? step : -1);
    // eslint-disable-next-line security/detect-object-injection -- index within the served question list.
    const alert = i < QUESTION_COUNT && flags.some((d) => d.question === config.questions[i]?.key);
    const tone = alert ? "bg-priority-red" : status === "Done" ? "bg-brand-green" : status === "Current" ? "bg-brand-green-dark" : "bg-surface-border";
    return (
      <button key={i} type="button" disabled={!begun || status === "Not yet"} onClick={() => jump(i)}
        aria-label={`${stepLabel(config, i)} (${alert ? "needs review" : status.toLowerCase()})`} title={stepLabel(config, i)}
        aria-current={status === "Current" ? "step" : undefined}
        className={`h-1.5 flex-1 rounded-full ${tone} ${status === "Current" ? "ring-2 ring-brand-green-tint" : ""} disabled:cursor-default`} />
    );
  });
  const noteToggle = (wide ? panel === "closed" || panel === "min" : true) && (
    <button type="button" className={`${BTN_GHOST} ${BTN_SM}`} onClick={() => (wide ? setPanel("open") : setNotesOpen(true))} aria-label="Open therapy note">
      <FileText className="h-3.5 w-3.5" /> <span className="hidden sm:inline">Therapy note</span>
    </button>
  );
  const sessionCrumb = (
    <>Session {note.session_number ?? ""} · <strong>{note.patient.name}</strong></>
  );
  const header = (
    <header className="flex flex-col gap-1.5 border-b border-surface-border bg-surface-card px-3 py-2 sm:px-5">
      <div className="flex items-center justify-between gap-2">
        <nav aria-label="Breadcrumb" className="min-w-0 overflow-x-auto">
          <ol className="flex items-center gap-1 whitespace-nowrap text-[12.5px] text-ink-500">
            <li><button type="button" onClick={onClose} className="rounded-md px-1.5 py-0.5 hover:bg-surface-bg hover:text-ink-900">Interventions</button></li>
            <li aria-hidden>›</li>
            <li><button type="button" onClick={() => setView("history")} aria-current={view === "history" ? "page" : undefined} className="rounded-md px-1.5 py-0.5 hover:bg-surface-bg hover:text-ink-900">Psychotherapy</button></li>
            {view !== "history" && <li aria-hidden>›</li>}
            {view === "past" && <li><span aria-current="page" className="px-1.5">Earlier session</span></li>}
            {view !== "history" && view !== "past" && (
              <li>
                <button type="button" onClick={() => setView("chat")} aria-current={view === "chat" && !begun ? "page" : undefined}
                  className="rounded-md px-1.5 py-0.5 text-ink-700 hover:bg-surface-bg">{sessionCrumb}</button>
              </li>
            )}
            {view === "chat" && begun && !example && <><li aria-hidden>›</li><StepMenu config={config} note={note} step={step} signed={signed} onJump={jump} /></>}
            {view === "chat" && example && <><li aria-hidden>›</li><li><span aria-current="page" className="px-1.5 font-semibold text-priority-orange">Example</span></li></>}
            {view === "client" && <><li aria-hidden>›</li><li><span aria-current="page" className="px-1.5 font-semibold text-ink-900">Client file</span></li></>}
            {view === "audit" && <><li aria-hidden>›</li><li><span aria-current="page" className="px-1.5 font-semibold text-ink-900">Audit trail</span></li></>}
          </ol>
        </nav>
        {noteToggle}
      </div>
      {view === "chat" && !example && (
        <div className="flex items-center gap-3">
          <span className="whitespace-nowrap text-[11.5px] font-semibold text-ink-500">
            {signed ? "Signed" : !begun ? "Not started" : step < QUESTION_COUNT ? `Question ${step + 1} of ${QUESTION_COUNT}` : stepLabel(config, step)}
          </span>
          <div className="flex flex-1 gap-1" aria-label="Session progress" role="group">{segments}</div>
        </div>
      )}
    </header>
  );

  const dictationOn = mode === "dictate" && config.dictation_enabled;
  const dictState: DictationState = dict.error ? "error" : speaking ? "speaking" : dict.countdown !== null ? "countdown"
    : dict.listening ? "listening" : dict.paused ? "paused" : "idle";
  const composed = join(draft, dict.finalText, dict.interim);
  const questionsDone = step >= REVIEW_STEP && !editKey && !awaitingReason;
  const placeholder = awaitingReason ? "Reason safety was not assessed…" : editKey ? "Edit your answer…"
    : step === SAFETY_STEP ? "Type yes, no or not assessed, or use the buttons above…"
      : questionsDone ? "Questions complete — use Edit under an answer to change it"
        : dictationOn ? "Your dictated answer appears here…" : "Answer in your own words…";
  const modeMenu = (
    <ModeMenu config={config} mode={dictationOn ? "dictate" : "type"} setMode={setMode} language={language} setLanguage={setLanguage}
      voice={voice} setVoice={setVoice} />
  );
  const finishDictation = () => {
    const text = composed;
    quiet();
    if (text.trim()) void submit(text, "DICTATED");
  };
  const composer = (
    <Composer value={composed} onChange={(v) => { dict.reset(); setDraft(v); }} onSend={() => void submit(composed, dictationOn ? "DICTATED" : "TYPED")}
      placeholder={placeholder} disabled={locked || busy || questionsDone} mode={dictationOn ? "dictate" : "type"} modeMenu={modeMenu}
      editing={editKey ? `Q${config.questions.findIndex((q) => q.key === editKey) + 1}` : null}
      onCancelEdit={() => { setEditKey(null); setDraft(""); }} focusSignal={focusSignal}
      hint={dictationOn ? "Questions are read aloud. Say “next question” when you finish, or pause and it moves on." : "Enter to send · Shift+Enter for a new line"}
      dictation={dictationOn ? {
        state: dictState, countdown: dict.countdown, error: dict.error, safety: safetyListening, done: questionsDone,
        onRepeat: repeatQuestion,
        onPause: () => { stopSpeaking(); setSpeaking(false); dict.pause(); },
        onDone: finishDictation, onStop: finishDictation,
        onSkip: () => { stopSpeaking(); setSpeaking(false); if (step <= SAFETY_STEP) dict.start(); },
        onSwitch: () => { dict.setError(null); setMode("type"); },
        onMic: () => { stopSpeaking(); setSpeaking(false); dict.start(); },
      } : null} />
  );

  const welcome = (
    <div className="flex flex-1 flex-col overflow-y-auto">
      <div className="m-auto flex w-full max-w-[680px] flex-col gap-5 px-4 py-8 sm:px-6">
        <h1 className="flex flex-col gap-2 font-display text-ink-900">
          <span className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[17px] font-semibold">
            Psychotherapy session {note.session_number ?? ""} done on
            <input type="text" inputMode="numeric" placeholder="dd/mm/yyyy" maxLength={10} value={dateText}
              aria-label="Session date (dd/mm/yyyy)" aria-describedby="psy-date-error" aria-invalid={!!dateError} disabled={locked}
              onChange={(e) => {
                let v = e.target.value.replace(/[^\d/]/g, "").replace(/\/{2,}/g, "/");
                const typing = v.length > dateText.length;
                if (typing && (/^\d{2}$/.test(v) || /^\d{1,2}\/\d{2}$/.test(v))) v += "/";
                setDateText(v.slice(0, 10));
                setDateError("");
              }}
              onBlur={() => void commitDate()} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); void commitDate(); } }}
              className={`w-[118px] rounded-md border bg-surface-card px-2 py-0.5 font-mono text-[15px] ${dateError ? "border-priority-red" : "border-surface-border"}`} />
            with
          </span>
          <span id="psy-date-error" role="status" className="text-[12.5px] font-normal text-priority-red">{dateError}</span>
          <span className="text-[28px] font-bold leading-tight">{note.patient.name}</span>
          <small className="font-sans text-[13.5px] font-normal text-ink-500">{note.author}, I’ll ask five short questions and one safety question, then organise your note.</small>
        </h1>
        <div className="flex items-center gap-2 rounded-[14px] border border-surface-border bg-surface-card p-2.5 shadow-sm">
          <button type="button" disabled={locked} onClick={() => begin()} className="flex min-w-0 flex-1 items-center gap-3 rounded-[10px] px-2 py-1.5 text-left hover:bg-surface-bg disabled:opacity-60">
            <span className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full bg-brand-green-tint text-brand-green">
              {dictationOn ? <Mic className="h-4 w-4" /> : <Keyboard className="h-4 w-4" />}
            </span>
            <span className="min-w-0">
              <strong className="block text-[14px]">Begin session</strong>
              <span className="block text-[12px] text-ink-500">{dictationOn ? "Questions will be read aloud; answer by voice." : "Questions appear one at a time; type your answers."}</span>
            </span>
          </button>
          {modeMenu}
          <button type="button" aria-label="Begin session" disabled={locked} onClick={() => begin()}
            className="flex h-9 w-9 items-center justify-center rounded-full bg-brand-green text-on-primary disabled:opacity-40">
            {dictationOn ? <Mic className="h-4 w-4" /> : <ArrowUp className="h-4 w-4" />}
          </button>
        </div>
        {!config.dictation_enabled && (
          <p className="text-[12px] text-ink-500">Dictation is turned off for this organisation (browser dictation sends the audio to the browser maker’s speech service). Questions can still be read aloud on this device.</p>
        )}
        <div className="flex flex-wrap gap-2">
          <button type="button" className={`${BTN_GHOST} ${BTN_SM} !rounded-full`} onClick={() => { quiet(); setExample(true); if (wide) setPanel("open"); }}>Try an example session</button>
          <button type="button" className={`${BTN_GHOST} ${BTN_SM} !rounded-full`} onClick={() => setView("client")}>Open client file</button>
        </div>
      </div>
    </div>
  );

  let centre: ReactNode;
  if (view === "history") {
    centre = <SessionHistory note={note} notes={notes} onBack={() => setView("chat")} onOpenCurrent={() => setView("chat")}
      onOpenPast={(id) => { setPastId(id); setView("past"); }} onNew={() => void newSession()} />;
  } else if (view === "past" && pastId) {
    centre = <PastNote config={config} id={pastId} onBack={() => setView("history")} />;
  } else if (view === "client") {
    centre = <ClientFile note={note} notes={notes} onBack={() => setView("chat")} />;
  } else if (view === "audit") {
    centre = <AuditTrail note={note} onBack={() => setView("chat")} />;
  }

  const thread = example ? (
    <ExampleThread config={config} onLeave={() => setExample(false)} />
  ) : (
    <Thread config={config} note={note} step={step} acks={acks} busy={busy}
      reviewExtras={note.status === "DRAFT" && note.is_author ? <SessionExtras note={note} patientId={patientId} save={save} /> : null}
      h={{
        onEdit: editAnswer,
        onReview: (key) => void save({ resolve_detection: { key } }),
        onModel: (code, include) => void save({ model_decision: { code, decision: include ? "INCLUDE" : "EXCLUDE" } }),
        onGoal: (index: number, decision: GoalDecision) => void save({ goal_link: { goal_index: index, decision } }),
        onSafety: (answer) => void chooseSafety(answer),
        onOpenRisk: () => setSafetyOpen(true),
        onOpenNotes: openNotes,
      }} />
  );

  const panelControls = wide ? (
    <>
      {panel === "expanded"
        ? <button type="button" className={`${BTN_GHOST} ${BTN_SM}`} aria-label="Collapse the note" title="Collapse" onClick={() => setPanel("open")}><Minimize2 className="h-3.5 w-3.5" /></button>
        : <button type="button" className={`${BTN_GHOST} ${BTN_SM}`} aria-label="Expand the note to full width" title="Expand" onClick={() => setPanel("expanded")}><Maximize2 className="h-3.5 w-3.5" /></button>}
      <button type="button" className={`${BTN_GHOST} ${BTN_SM}`} aria-label="Minimise the note" title="Minimise" onClick={() => setPanel("min")}><Minus className="h-3.5 w-3.5" /></button>
      <button type="button" className={`${BTN_GHOST} ${BTN_SM}`} aria-label="Close the note" title="Close" onClick={() => setPanel("closed")}><X className="h-3.5 w-3.5" /></button>
    </>
  ) : (
    <>
      <button type="button" className={`${BTN_GHOST} ${BTN_SM}`} aria-label={full ? "Collapse the note" : "Expand the note to full width"} onClick={() => setFull((f) => !f)}>
        {full ? <Minimize2 className="h-3.5 w-3.5" /> : <Maximize2 className="h-3.5 w-3.5" />}
      </button>
      <button type="button" className={`${BTN_GHOST} ${BTN_SM}`} aria-label="Close the note" onClick={() => setNotesOpen(false)}><X className="h-3.5 w-3.5" /></button>
    </>
  );
  const notePanel = (
    <NotePanel config={config} note={note} save={save} organise={organise} sign={sign} amend={amend}
      controls={panelControls} example={example} busy={busy} />
  );

  return (
    <>
      <nav aria-label="Workspace" className="flex w-14 flex-shrink-0 flex-col items-center gap-1.5 border-r border-surface-border bg-surface-card py-3 sm:w-16">
        <RailButton label="Back to Interventions" onClick={onClose}><ArrowLeft className="h-5 w-5" /></RailButton>
        <div aria-hidden className="my-1 flex h-8 w-8 items-center justify-center rounded-full bg-brand-green text-[13px] font-bold text-on-primary">C</div>
        <RailButton label="New session" onClick={() => void newSession()}><Plus className="h-5 w-5" /></RailButton>
        <RailButton label="Chat · session history" current={view === "history" || view === "past"} onClick={() => setView("history")}><MessageSquare className="h-5 w-5" /></RailButton>
        <RailButton label="Client file" current={view === "client"} onClick={() => setView("client")}><User className="h-5 w-5" /></RailButton>
        <RailButton label="Therapy approaches" onClick={() => setLibraryOpen(true)}><Layers className="h-5 w-5" /></RailButton>
        <RailButton label="Audit trail" current={view === "audit"} onClick={() => setView("audit")}><Clock className="h-5 w-5" /></RailButton>
      </nav>

      {!(wide && panel === "expanded") && (
        <section className="flex min-w-0 flex-1 flex-col" aria-label="Session">
          {header}
          {error && <div className="px-4 pt-2"><ErrorNote>{error}</ErrorNote></div>}
          {centre ? (
            <div className="min-h-0 flex-1 overflow-y-auto">{centre}</div>
          ) : !begun && !example ? welcome : (
            <>
              <div ref={scroller} className="min-h-0 flex-1 overflow-y-auto">
                <div className="mx-auto w-full max-w-[760px] px-4 py-5 sm:px-6">{thread}</div>
              </div>
              {!example && !signed && note.is_author && composer}
            </>
          )}
        </section>
      )}

      {wide && panel === "open" && (
        <div role="separator" aria-orientation="vertical" aria-label="Resize the therapy note" tabIndex={0}
          aria-valuenow={width} aria-valuemin={MIN_WIDTH} aria-valuemax={maxWidth()}
          onPointerDown={startDrag} onKeyDown={resizeKey}
          className="w-1.5 flex-shrink-0 cursor-col-resize bg-transparent hover:bg-brand-green-tint focus-visible:bg-brand-green-tint" />
      )}
      {wide && (panel === "open" || panel === "expanded") && (
        <aside aria-label="Therapy note" style={panel === "open" ? { width } : undefined}
          className={`min-h-0 border-l border-surface-border ${panel === "expanded" ? "min-w-0 flex-1" : "flex-shrink-0"}`}>
          {notePanel}
        </aside>
      )}
      {wide && panel === "min" && (
        <aside aria-label="Therapy note (minimised)" className="flex w-[52px] flex-shrink-0 flex-col items-center border-l border-surface-border bg-surface-card py-3">
          <button type="button" onClick={() => setPanel("open")} aria-label="Restore the therapy note"
            className="flex flex-col items-center gap-2 rounded-md px-1 py-2 text-[11px] font-semibold text-ink-700 hover:bg-surface-bg">
            <FileText className="h-4 w-4" />
            <span className="[writing-mode:vertical-rl]">Therapy note</span>
          </button>
        </aside>
      )}
      {!wide && notesOpen && (
        <>
          <div className="fixed inset-0 z-[104] bg-surface-scrim" onClick={() => setNotesOpen(false)} />
          <aside ref={slideOver} role="dialog" aria-modal="true" aria-label="Therapy note"
            className={`fixed inset-y-0 right-0 z-[105] w-full shadow-md ${full ? "" : "max-w-[520px]"}`}>
            {notePanel}
          </aside>
        </>
      )}

      {safetyOpen && <SafetyModal config={config} note={note} onClose={closeSafety} onSave={save} />}
      {libraryOpen && <ApproachesDialog onClose={() => setLibraryOpen(false)}
        onChanged={() => { if (accessToken) getPsyNote(accessToken, note.id).then(setNote).catch(() => undefined); }} />}
      {toast && (
        <div role="status" className="fixed bottom-24 left-1/2 z-[130] -translate-x-1/2 rounded-md bg-ink-900 px-3 py-1.5 text-[12.5px] text-surface-card shadow-md">{toast}</div>
      )}
    </>
  );
}
