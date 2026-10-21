import type { InputMode, PsyConfig, PsyNote } from "../../../../../lib/psychotherapyNoteApi";

// Small pure helpers for the psychotherapy session workspace. Nothing here
// touches browser storage except `readPref`/`writePref`, which hold
// non-clinical UI preferences only (panel width, input mode, language,
// read-aloud) — never note content (CLAUDE.md §5).

export const QUESTION_COUNT = 5;
export const SAFETY_STEP = 5;
export const REVIEW_STEP = 6;

const pad = (n: number) => String(n).padStart(2, "0");

export function modeLabel(mode: InputMode | undefined) {
  return mode === "DICTATED" || mode === "SPEAK" ? "Dictated" : "Typed";
}

export function hhmm(iso: string | null | undefined) {
  if (!iso) return "";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function ddmmyyyy(iso: string | null | undefined) {
  if (!iso) return "";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}`;
}

/** Parse a dd/mm/yyyy date typed by the clinician: a Date, or the error to show. */
export function parseDdMmYyyy(text: string, today = new Date()): { date: Date } | { error: string } {
  const example = ddmmyyyy(today.toISOString());
  const m = /^\s*(\d{1,2})\/(\d{1,2})\/(\d{4})\s*$/.exec(text);
  if (!m) return { error: `Enter the date as dd/mm/yyyy, for example ${example}.` };
  const [day, month, year] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const d = new Date(year, month - 1, day);
  if (d.getFullYear() !== year || d.getMonth() !== month - 1 || d.getDate() !== day) {
    return { error: `${text.trim()} is not a real date. Check the day and month.` };
  }
  return { date: d };
}

/** The session's date replaced, its time of day kept (local wall clock). */
export function withDate(iso: string, date: Date) {
  const d = new Date(iso);
  const out = new Date(date.getFullYear(), date.getMonth(), date.getDate(), d.getHours(), d.getMinutes());
  return `${out.getFullYear()}-${pad(out.getMonth() + 1)}-${pad(out.getDate())}T${pad(out.getHours())}:${pad(out.getMinutes())}`;
}

export function toLocalInput(iso: string) {
  const d = new Date(iso);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** Recognition / voice language for a served language code (Sheng is recognised as Kiswahili). */
export function speechLang(code: string) {
  return code === "sheng" ? "sw-KE" : code;
}

export function answerText(note: PsyNote, key: string) {
  // eslint-disable-next-line security/detect-object-injection -- question key from the served config.
  return note.answers[key]?.text ?? "";
}

/** The first question still unanswered, else safety, else review. */
export function currentStep(note: PsyNote, config: PsyConfig) {
  const open = config.questions.findIndex((q) => !answerText(note, q.key).trim());
  if (open >= 0) return open;
  return note.safety_answer ? REVIEW_STEP : SAFETY_STEP;
}

export type StepStatus = "Current" | "Done" | "Needs review" | "Open" | "Not yet";

export function stepStatus(note: PsyNote, config: PsyConfig, index: number, active: number): StepStatus {
  if (index === active) return "Current";
  if (index < QUESTION_COUNT) {
    // eslint-disable-next-line security/detect-object-injection -- index within the served list.
    const key = config.questions[index].key;
    if (note.detections.some((d) => d.question === key && !d.resolution)) return "Needs review";
    return answerText(note, key).trim() ? "Done" : index < active ? "Open" : "Not yet";
  }
  if (index === SAFETY_STEP) {
    if (!note.safety_answer) return currentStep(note, config) >= SAFETY_STEP ? "Open" : "Not yet";
    const pending = note.blockers.some((b) => ["SAFETY_DETAIL", "RISK_LINK", "SAFETY_NOT_ASSESSED"].includes(b.code));
    return pending ? "Needs review" : "Done";
  }
  if (note.status === "SIGNED") return "Done";
  return note.safety_answer ? "Open" : "Not yet";
}

export function stepLabel(config: PsyConfig, index: number) {
  // eslint-disable-next-line security/detect-object-injection -- index within the served question list.
  if (index < QUESTION_COUNT) return `Q${index + 1} · ${config.questions[index]?.title ?? ""}`;
  return index === SAFETY_STEP ? "Safety question" : "Review & sign";
}

/** Non-clinical UI preference (panel width, input mode, language, read-aloud). */
export function readPref(key: string): string | null {
  try {
    return window.localStorage.getItem(`psy-pref:${key}`);
  } catch {
    return null;
  }
}

export function writePref(key: string, value: string) {
  try {
    window.localStorage.setItem(`psy-pref:${key}`, value);
  } catch {
    // Storage blocked (private window): the preference simply isn't remembered.
  }
}

export async function copyText(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

/** Save a text file the clinician asked for (user-initiated export, not storage). */
export function downloadText(filename: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: "text/plain;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export function transcriptText(note: PsyNote) {
  return note.transcript.map((t, i) => {
    const lines = [`Q${i + 1}. ${t.title}`, `${modeLabel(t.mode)}${t.answered_at ? ` · ${hhmm(t.answered_at)}` : ""} · ${t.language}`,
      t.text || "(not answered)"];
    if (t.translation?.status === "done") lines.push(`English translation (${t.translation.model}): ${t.translation.text}`);
    return lines.join("\n");
  }).join("\n\n");
}
