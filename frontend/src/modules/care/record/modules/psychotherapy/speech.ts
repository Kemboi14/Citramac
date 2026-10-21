import { useCallback, useEffect, useRef, useState } from "react";

// Speech for the psychotherapy session workspace.
//
// Reading questions aloud uses window.speechSynthesis (on-device) and is always
// available. Dictation uses the browser's speech recognition, which in most
// browsers sends the audio to the browser vendor's speech service — so it is
// only offered when the organisation has enabled it (PSYCHOTHERAPY_DICTATION_ENABLED,
// master prompt X-12). Nothing heard is stored in the browser: committed text
// goes straight to the server draft.

interface RecognitionAlternative { transcript: string }
interface RecognitionResult extends ArrayLike<RecognitionAlternative> { isFinal: boolean }
interface RecognitionEvent { resultIndex: number; results: ArrayLike<RecognitionResult> }
interface Recognizer {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: ((e: RecognitionEvent) => void) | null;
  onend: (() => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  start: () => void;
  stop: () => void;
  abort: () => void;
}
type RecognizerCtor = new () => Recognizer;

export function recognizerCtor(): RecognizerCtor | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as { SpeechRecognition?: RecognizerCtor; webkitSpeechRecognition?: RecognizerCtor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export function synthesisAvailable() {
  return typeof window !== "undefined" && "speechSynthesis" in window;
}

const NATURAL = /natural|neural|premium|enhanced|online|google/i;

function pickVoice(lang: string) {
  const voices = window.speechSynthesis.getVoices();
  const base = lang.split("-")[0].toLowerCase();
  const exact = voices.filter((v) => v.lang.toLowerCase() === lang.toLowerCase());
  const family = voices.filter((v) => v.lang.toLowerCase().startsWith(base));
  const pool = exact.length ? exact : family;
  return pool.find((v) => NATURAL.test(v.name)) ?? pool[0] ?? null;
}

/** Read text aloud on the device (rate 0.9, the most natural voice for the language). */
export function speak(text: string, lang: string, onEnd?: () => void) {
  if (!synthesisAvailable()) {
    onEnd?.();
    return;
  }
  window.speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = lang;
  utterance.rate = 0.9;
  const voice = pickVoice(lang);
  if (voice) utterance.voice = voice;
  utterance.onend = () => onEnd?.();
  utterance.onerror = () => onEnd?.();
  window.speechSynthesis.speak(utterance);
}

export function stopSpeaking() {
  if (synthesisAvailable()) window.speechSynthesis.cancel();
}

const COMMIT_COMMANDS = ["next question", "end of answer", "that's all", "thats all", "that is all", "swali linalofuata"];
const REPEAT_COMMANDS = ["repeat question", "repeat the question", "rudia swali"];
export const SILENCE_PROMPT_MS = 4500;
export const SILENCE_COMMIT_MS = 8000;

export type DictationError = "blocked" | "no-mic" | "unsupported" | "network" | "other";
export const DICTATION_ERRORS: Record<DictationError, string> = {
  blocked: "The microphone is blocked for this site. Allow microphone access in the browser, or switch to typing.",
  "no-mic": "No microphone was found. Connect one, or switch to typing.",
  unsupported: "This browser does not support dictation. Use a recent Chrome or Edge, or switch to typing.",
  network: "Dictation lost its connection to the browser's speech service. Try again, or switch to typing.",
  other: "Dictation stopped unexpectedly. Try again, or switch to typing.",
};

function stripCommand(text: string, commands: string[]) {
  const lower = text.toLowerCase();
  for (const c of commands) {
    const at = lower.lastIndexOf(c);
    if (at >= 0) return { found: true, text: `${text.slice(0, at)}${text.slice(at + c.length)}`.replace(/\s+/g, " ").trim() };
  }
  return { found: false, text };
}

/** "YES" / "NO" / "NOT_ASSESSED" heard in a safety answer, if any. */
export function safetyFromSpeech(text: string): "YES" | "NO" | "NOT_ASSESSED" | null {
  const t = ` ${text.toLowerCase().replace(/[.,!?]/g, " ")} `;
  if (t.includes(" not assessed ") || t.includes(" haikutathminiwa ")) return "NOT_ASSESSED";
  if (/ (yes|ndiyo|ndio) /.test(t)) return "YES";
  if (/ (no|hapana) /.test(t)) return "NO";
  return null;
}

export interface DictationHandlers {
  /** The answer is finished (voice command, Done, or 8 s of silence). */
  onCommit: (text: string) => void;
  onRepeat: () => void;
  /** Safety step: a yes / no / not assessed was heard. */
  onSafety?: (answer: "YES" | "NO" | "NOT_ASSESSED") => void;
}

/** Continuous dictation with interim results, silence auto-commit and voice commands. */
export function useDictation(lang: string, safetyMode: boolean, handlers: DictationHandlers) {
  const [listening, setListening] = useState(false);
  const [paused, setPaused] = useState(false);
  const [finalText, setFinalText] = useState("");
  const [interim, setInterim] = useState("");
  const [countdown, setCountdown] = useState<number | null>(null);
  const [error, setError] = useState<DictationError | null>(null);
  const rec = useRef<Recognizer | null>(null);
  const want = useRef(false);
  const textRef = useRef("");
  const timers = useRef<number[]>([]);
  const handlersRef = useRef(handlers);
  useEffect(() => {
    handlersRef.current = handlers;
  });

  const clearTimers = useCallback(() => {
    timers.current.forEach((t) => window.clearTimeout(t));
    timers.current = [];
    setCountdown(null);
  }, []);

  const stop = useCallback(() => {
    want.current = false;
    clearTimers();
    rec.current?.abort();
    rec.current = null;
    setListening(false);
    setInterim("");
  }, [clearTimers]);

  const commit = useCallback(() => {
    const text = textRef.current.trim();
    textRef.current = "";
    setFinalText("");
    setInterim("");
    clearTimers();
    if (text) handlersRef.current.onCommit(text);
  }, [clearTimers]);

  const armSilence = useCallback(() => {
    clearTimers();
    if (!textRef.current.trim() || safetyMode) return;
    timers.current.push(window.setTimeout(() => {
      const start = Date.now();
      const tick = () => {
        const left = Math.max(0, Math.ceil((SILENCE_COMMIT_MS - SILENCE_PROMPT_MS - (Date.now() - start)) / 1000));
        setCountdown(left);
        if (left > 0) timers.current.push(window.setTimeout(tick, 250));
      };
      tick();
    }, SILENCE_PROMPT_MS));
    timers.current.push(window.setTimeout(() => commit(), SILENCE_COMMIT_MS));
  }, [clearTimers, commit, safetyMode]);

  const start = useCallback(() => {
    const Ctor = recognizerCtor();
    if (!Ctor) {
      setError("unsupported");
      return;
    }
    setError(null);
    setPaused(false);
    want.current = true;
    const r = new Ctor();
    r.lang = lang;
    r.continuous = true;
    r.interimResults = true;
    r.onresult = (e) => {
      let live = "";
      for (let i = e.resultIndex; i < e.results.length; i += 1) {
        // eslint-disable-next-line security/detect-object-injection -- numeric index into the browser's result list.
        const result = e.results[i];
        const said = result[0]?.transcript ?? "";
        if (!result.isFinal) {
          live += said;
          continue;
        }
        if (safetyMode) {
          const answer = safetyFromSpeech(said);
          if (answer) {
            handlersRef.current.onSafety?.(answer);
            stop();
            return;
          }
          continue;
        }
        let next = `${textRef.current} ${said}`.replace(/\s+/g, " ").trim();
        const repeat = stripCommand(next, REPEAT_COMMANDS);
        if (repeat.found) {
          textRef.current = repeat.text;
          setFinalText(repeat.text);
          handlersRef.current.onRepeat();
          return;
        }
        const done = stripCommand(next, COMMIT_COMMANDS);
        next = done.text;
        textRef.current = next;
        setFinalText(next);
        if (done.found) {
          commit();
          return;
        }
      }
      setInterim(live);
      armSilence();
    };
    r.onerror = (e) => {
      const map: Record<string, DictationError> = {
        "not-allowed": "blocked", "service-not-allowed": "blocked", "audio-capture": "no-mic", network: "network",
      };
      if (e.error === "no-speech" || e.error === "aborted") return;
      want.current = false;
      setError(map[e.error] ?? "other");
    };
    // Browsers end continuous recognition after a pause; keep listening until stopped.
    r.onend = () => {
      if (want.current && rec.current === r) {
        try {
          r.start();
        } catch {
          setListening(false);
        }
      } else if (rec.current === r || rec.current === null) {
        setListening(false);
      }
    };
    rec.current?.abort();
    rec.current = r;
    try {
      r.start();
      setListening(true);
    } catch {
      setError("other");
    }
  }, [lang, safetyMode, stop, commit, armSilence]);

  const pause = useCallback(() => {
    want.current = false;
    clearTimers();
    rec.current?.stop();
    setListening(false);
    setPaused(true);
  }, [clearTimers]);

  const reset = useCallback(() => {
    textRef.current = "";
    setFinalText("");
    setInterim("");
  }, []);

  useEffect(() => () => {
    want.current = false;
    timers.current.forEach((t) => window.clearTimeout(t));
    rec.current?.abort();
  }, []);

  return { listening, paused, finalText, interim, countdown, error, start, stop, pause, commit, reset, setError };
}
