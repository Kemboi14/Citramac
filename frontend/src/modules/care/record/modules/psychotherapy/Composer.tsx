import { ArrowUp, Check, ChevronDown, Keyboard, Mic, Pencil, Square, Volume2, VolumeX, X } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from "react";
import type { PsyConfig } from "../../../../../lib/psychotherapyNoteApi";
import { BTN, BTN_GHOST, BTN_SM, FIELD_LABEL, INPUT } from "../../../shared/styles";
import { DICTATION_ERRORS, type DictationError } from "./speech";

export type InputChoice = "type" | "dictate";
export type DictationState = "idle" | "speaking" | "listening" | "countdown" | "paused" | "error";

/** Answer mode menu: Type / Dictate, the answer language and read-aloud. */
export function ModeMenu({ config, mode, setMode, language, setLanguage, voice, setVoice }: {
  config: PsyConfig;
  mode: InputChoice;
  setMode: (m: InputChoice) => void;
  language: string;
  setLanguage: (code: string) => void;
  voice: boolean;
  setVoice: (on: boolean) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
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
    ref.current?.querySelector<HTMLElement>('[aria-checked="true"]')?.focus();
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onClick);
    };
  }, [open]);
  const translated = config.languages.find((l) => l.code === language)?.translated;
  const item = (value: InputChoice, Icon: typeof Mic, name: string, desc: string, disabled = false) => (
    <button type="button" role="menuitemradio" aria-checked={mode === value} disabled={disabled}
      onClick={() => { setMode(value); setOpen(false); button.current?.focus(); }}
      className="flex w-full items-start gap-2.5 rounded-md px-2.5 py-2 text-left hover:bg-surface-bg disabled:cursor-not-allowed disabled:opacity-60">
      <Icon className="mt-0.5 h-4 w-4 flex-shrink-0 text-ink-700" />
      <span className="min-w-0 flex-1">
        <span className="block text-[13px] font-semibold text-ink-900">{name}</span>
        <span className="block text-[11.5px] text-ink-500">{desc}</span>
      </span>
      {mode === value && <Check className="mt-0.5 h-4 w-4 text-brand-green" />}
    </button>
  );
  return (
    <div ref={ref} className="relative">
      <button ref={button} type="button" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((o) => !o)}
        className="inline-flex items-center gap-1 rounded-full border border-surface-border px-2.5 py-1 text-[12px] font-semibold text-ink-700 hover:bg-surface-bg">
        {mode === "dictate" ? <Mic className="h-3.5 w-3.5" /> : <Keyboard className="h-3.5 w-3.5" />}
        {mode === "dictate" ? "Dictate" : "Type"}
        <ChevronDown className="h-3.5 w-3.5" />
      </button>
      {open && (
        <div role="menu" aria-label="Answer mode"
          className="absolute bottom-full right-0 z-30 mb-2 w-[min(320px,calc(100vw-32px))] rounded-lg border border-surface-border bg-surface-card p-1.5 shadow-md">
          <div className="flex items-center justify-between px-2.5 py-1.5">
            <strong className="text-[13px]">How will you answer?</strong>
            <button type="button" aria-label="Close" onClick={() => setOpen(false)} className="rounded-md p-1 text-ink-500 hover:bg-surface-bg"><X className="h-4 w-4" /></button>
          </div>
          {item("type", Keyboard, "Type", "Read each question and type your answer.")}
          {item("dictate", Mic, "Dictate",
            config.dictation_enabled
              ? "Questions are read aloud at a calm pace. Answer by voice; it is transcribed for you."
              : "Turned off by your organisation: browser dictation sends the audio to the browser maker's speech service. Type your answers instead.",
            !config.dictation_enabled)}
          <div className="my-1 border-t border-surface-border" />
          <label className="flex items-center justify-between gap-2 px-2.5 py-1.5 text-[12.5px]">
            <span className={FIELD_LABEL}>Language</span>
            <select className={`${INPUT} !w-auto`} value={language} onChange={(e) => setLanguage(e.target.value)}>
              {config.languages.map((l) => <option key={l.code} value={l.code}>{l.label}</option>)}
            </select>
          </label>
          {translated && (
            <p className="px-2.5 pb-1.5 text-[11.5px] text-ink-500">
              {config.ai_enabled
                ? "Answers are translated into clear English for the note. Your original words stay in the transcript."
                : `Translation is not switched on for this organisation. ${config.processed_labels.not_translated}.`}
            </p>
          )}
          <div className="flex items-center justify-between gap-2 px-2.5 py-1.5 text-[12.5px]">
            <span>Read questions aloud</span>
            <button type="button" aria-pressed={voice} onClick={() => setVoice(!voice)}
              className={`${BTN_GHOST} ${BTN_SM}`}>
              {voice ? <><Volume2 className="h-3.5 w-3.5" /> On</> : <><VolumeX className="h-3.5 w-3.5" /> Off</>}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/** The dictation status strip above the composer's text box. */
function DictationStrip({ state, countdown, error, onRepeat, onPause, onDone, onSkip, onSwitch, safety, done }: {
  state: DictationState;
  countdown: number | null;
  error: DictationError | null;
  onRepeat: () => void;
  onPause: () => void;
  onDone: () => void;
  onSkip: () => void;
  onSwitch: () => void;
  safety: boolean;
  done: boolean;
}) {
  // eslint-disable-next-line security/detect-object-injection -- error code from a fixed union.
  const text = error ? DICTATION_ERRORS[error]
    : state === "speaking" ? "Reading the question…"
      : state === "countdown" ? `Saving your answer in ${countdown ?? 0}s · keep talking to add more`
        : state === "listening" ? (safety ? "Listening… say yes, no, or not assessed." : "Listening… take your time. Say “next question” when you finish.")
          : state === "paused" ? "Paused. Edit the text if needed, then send, or tap the microphone to continue."
            : done ? "All questions answered." : "Ready. Tap the microphone to answer.";
  const live = state === "listening" || state === "countdown";
  return (
    <div className="flex flex-wrap items-center gap-2 border-b border-surface-border px-3 py-2" role="status">
      <span aria-hidden className={`h-2.5 w-2.5 rounded-full ${live ? "animate-pulse bg-priority-red" : state === "speaking" ? "animate-pulse bg-brand-green" : "bg-surface-border"}`} />
      <span className={`min-w-0 flex-1 text-[12.5px] ${error ? "text-priority-red" : "text-ink-700"}`}>{text}</span>
      <div className="flex flex-wrap gap-1.5">
        {error && <button type="button" className={`${BTN} ${BTN_SM}`} onClick={onSwitch}>Switch to typing</button>}
        {!error && state === "speaking" && <button type="button" className={`${BTN_GHOST} ${BTN_SM}`} onClick={onSkip}>Skip reading</button>}
        {!error && !done && state !== "speaking" && <button type="button" className={`${BTN_GHOST} ${BTN_SM}`} onClick={onRepeat}>Repeat question</button>}
        {!error && live && <button type="button" className={`${BTN_GHOST} ${BTN_SM}`} onClick={onPause}>Pause</button>}
        {!error && live && !safety && <button type="button" className={`${BTN} ${BTN_SM}`} onClick={onDone}>Done</button>}
      </div>
    </div>
  );
}

/** Auto-growing answer box: Enter sends, Shift+Enter is a new line. */
export function Composer({ value, onChange, onSend, placeholder, disabled, mode, modeMenu, editing, onCancelEdit,
  dictation, hint, focusSignal }: {
  value: string;
  onChange: (v: string) => void;
  onSend: () => void;
  placeholder: string;
  disabled: boolean;
  mode: InputChoice;
  modeMenu: ReactNode;
  editing: string | null;
  onCancelEdit: () => void;
  dictation: null | {
    state: DictationState; countdown: number | null; error: DictationError | null; safety: boolean; done: boolean;
    onRepeat: () => void; onPause: () => void; onDone: () => void; onSkip: () => void; onSwitch: () => void;
    onMic: () => void; onStop: () => void;
  };
  hint: string;
  /** Changes when the answer box should take focus (a question asked, Edit pressed). */
  focusSignal: number;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    // Phones keep the keyboard closed until the clinician taps the box.
    if (focusSignal && window.innerWidth > 640) ref.current?.focus();
  }, [focusSignal]);
  useLayoutEffect(() => {
    const t = ref.current;
    if (!t) return;
    t.style.height = "auto";
    t.style.height = `${Math.min(220, t.scrollHeight)}px`;
  }, [value]);
  const live = !!dictation && (dictation.state === "listening" || dictation.state === "countdown");
  const has = value.trim().length > 0;
  function onKey(e: ReactKeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      if (has && !disabled) onSend();
    }
  }
  let send = (
    <button type="button" aria-label="Send" disabled={disabled || !has} onClick={onSend}
      className="flex h-9 w-9 items-center justify-center rounded-full bg-brand-green text-on-primary disabled:opacity-40">
      <ArrowUp className="h-4 w-4" />
    </button>
  );
  if (dictation && live) {
    send = (
      <button type="button" aria-label="Stop dictating" onClick={dictation.onStop}
        className="flex h-9 w-9 items-center justify-center rounded-full bg-priority-red text-on-primary">
        <Square className="h-3.5 w-3.5" />
      </button>
    );
  } else if (dictation && !has) {
    send = (
      <button type="button" aria-label="Start dictating" disabled={disabled} onClick={dictation.onMic}
        className="flex h-9 w-9 items-center justify-center rounded-full bg-brand-green text-on-primary disabled:opacity-40">
        <Mic className="h-4 w-4" />
      </button>
    );
  }
  return (
    <div className="border-t border-surface-border bg-surface-bg px-3 pb-3 pt-2 sm:px-5">
      <div className="mx-auto w-full max-w-[760px]">
        {editing && (
          <div className="mb-1.5 flex items-center gap-2 text-[12px] text-ink-700">
            <Pencil className="h-3.5 w-3.5" /> Editing answer to {editing}
            <button type="button" className="font-semibold text-brand-green hover:underline" onClick={onCancelEdit}>Cancel</button>
          </div>
        )}
        <div className="overflow-hidden rounded-[14px] border border-surface-border bg-surface-card shadow-sm focus-within:border-brand-green">
          {dictation && mode === "dictate" && (
            <DictationStrip state={dictation.state} countdown={dictation.countdown} error={dictation.error}
              safety={dictation.safety} done={dictation.done} onRepeat={dictation.onRepeat} onPause={dictation.onPause}
              onDone={dictation.onDone} onSkip={dictation.onSkip} onSwitch={dictation.onSwitch} />
          )}
          <textarea ref={ref} rows={1} value={value} placeholder={placeholder} aria-label="Your answer" disabled={disabled}
            readOnly={live || dictation?.state === "speaking"} onChange={(e) => onChange(e.target.value)} onKeyDown={onKey}
            className="block max-h-[220px] w-full resize-none bg-transparent px-3.5 py-3 text-[14px] text-ink-900 outline-none placeholder:text-ink-400 disabled:opacity-60" />
          <div className="flex items-center justify-end gap-2 px-2.5 pb-2">
            {modeMenu}
            {send}
          </div>
        </div>
        <p className="mt-1.5 text-center text-[11px] text-ink-500">{hint}</p>
      </div>
    </div>
  );
}
