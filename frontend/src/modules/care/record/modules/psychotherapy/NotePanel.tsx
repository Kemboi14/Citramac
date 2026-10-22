import { ChevronDown, Copy, Download, Pencil, Share2 } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import type { PsyConfig, PsyNote } from "../../../../../lib/psychotherapyNoteApi";
import { formatDateTime } from "../../../shared/format";
import { BTN, BTN_GHOST, BTN_SM, FIELD_LABEL, INPUT } from "../../../shared/styles";
import { Callout, Tag } from "../../../shared/ui";
import { EXAMPLE_ANSWERS, EXAMPLE_SECTION } from "./exampleSession";
import { copyText, ddmmyyyy, downloadText, hhmm, modeLabel, toLocalInput, transcriptText } from "./helpers";

type Save = (body: Record<string, unknown>) => Promise<boolean>;

const NOTE_SECTIONS = (config: PsyConfig) => config.sections.filter((s) => s.key !== "session_information");

const STATUS = "whitespace-nowrap rounded-[5px] px-[7px] py-[3px] font-mono text-[10.5px] font-medium uppercase tracking-[.06em]";
/** Mockup section heading: small accent capitals. */
const SEC_H = "font-sans text-[11.5px] font-bold uppercase tracking-[.09em] text-brand-green";
const LINK = "font-sans text-[12px] text-ink-500 underline underline-offset-2 hover:text-ink-900";

function StatusPill({ signed, example }: { signed: boolean; example?: boolean }) {
  if (example) return <span className={`${STATUS} bg-priority-orange-tint text-priority-orange`}>Example — not saved</span>;
  return signed
    ? <span className={`${STATUS} bg-brand-green-tint text-brand-green`}>Signed</span>
    : <span className={`${STATUS} bg-priority-orange-tint text-priority-orange`}>Draft — review required</span>;
}

/** The therapy-note panel: Note | Transcript, section editing, the sign-off
 * checklist and signing; amendments once signed. Every rule is the server's. */
export function NotePanel({ config, note, save, organise, sign, amend, controls, example, busy }: {
  config: PsyConfig;
  note: PsyNote;
  save: Save;
  organise: () => Promise<boolean>;
  sign: () => Promise<boolean>;
  amend: (body: { section: string; text: string; reason: string }) => Promise<boolean>;
  controls: ReactNode;
  example: boolean;
  busy: boolean;
}) {
  const [tab, setTab] = useState<"note" | "transcript">("note");
  const signed = note.status === "SIGNED";
  const noteText = example ? exampleText(config) : note.rendered;
  return (
    <div className="flex h-full min-h-0 flex-col bg-surface-card">
      <div className="flex flex-col gap-2.5 border-b border-surface-border px-[18px] pb-2.5 pt-3.5">
        <div className="flex flex-wrap items-center gap-x-2.5 gap-y-2">
          <h2 className="whitespace-nowrap text-[15px] font-semibold text-ink-900">Therapy note</h2>
          <StatusPill signed={signed} example={example} />
          <div className="ml-auto flex items-center gap-0.5">
            {!example && <ShareMenu note={note} />}
            {controls}
          </div>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div role="tablist" aria-label="Therapy note views" className="flex gap-0.5 rounded-[9px] bg-surface-bg p-[3px]">
            {(["note", "transcript"] as const).map((t) => (
              <button key={t} type="button" role="tab" aria-selected={tab === t} id={`psy-tab-${t}`} aria-controls={`psy-panel-${t}`}
                onClick={() => setTab(t)}
                className={`rounded-[7px] px-3 py-1 text-[12.5px] font-semibold ${tab === t ? "bg-surface-card text-ink-900 shadow-sm" : "text-ink-500 hover:text-ink-900"}`}>
                {t === "note" ? "Note" : "Transcript"}
              </button>
            ))}
          </div>
          {!example && <ProcessingLine note={note} />}
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-5 pt-4" role="tabpanel" id={`psy-panel-${tab}`} aria-labelledby={`psy-tab-${tab}`}>
        {example ? (
          tab === "note" ? <ExamplePreview config={config} /> : <ExampleTranscript config={config} />
        ) : tab === "note" ? (
          <NoteBody config={config} note={note} save={save} organise={organise} busy={busy} />
        ) : (
          <Transcript config={config} note={note} />
        )}
      </div>
      {example ? (
        <div className="border-t border-surface-border px-4 py-3 text-[12px] text-ink-500">
          This is an example to show how the workspace works. It is not saved and cannot be signed.
          <button type="button" className={`${BTN_GHOST} ${BTN_SM} ml-2`} onClick={() => void copyText(noteText)}><Copy className="h-3.5 w-3.5" /> Copy</button>
        </div>
      ) : signed ? (
        <SignedFooter config={config} note={note} amend={amend} />
      ) : (
        <SignFooter config={config} note={note} save={save} sign={sign} busy={busy} />
      )}
    </div>
  );
}

function exampleText(config: PsyConfig) {
  return NOTE_SECTIONS(config).map((s) => {
    // eslint-disable-next-line security/detect-object-injection -- question / section key from the fixed example map.
    const key = Object.keys(EXAMPLE_SECTION).find((k) => EXAMPLE_SECTION[k] === s.key);
    // eslint-disable-next-line security/detect-object-injection -- question / section key from the fixed example map.
    return `${s.title}\n${key ? EXAMPLE_ANSWERS[key] : "Not part of the example."}`;
  }).join("\n\n");
}

function ExamplePreview({ config }: { config: PsyConfig }) {
  return (
    <div className="flex flex-col gap-[18px]">
      <Callout tone="warning">Example — not saved. The answers are placed under the section each question feeds; a real session is organised by the server and reviewed by you.</Callout>
      {NOTE_SECTIONS(config).map((s) => {
        // eslint-disable-next-line security/detect-object-injection -- question / section key from the fixed example map.
        const key = Object.keys(EXAMPLE_SECTION).find((k) => EXAMPLE_SECTION[k] === s.key);
        return (
          <section key={s.key}>
            <h3 className={SEC_H}>{s.title}</h3>
            {/* eslint-disable-next-line security/detect-object-injection -- question / section key from the fixed example map. */}
            <p className="mt-1.5 whitespace-pre-wrap font-doc text-[15.5px] leading-[1.55] text-ink-900">{key ? EXAMPLE_ANSWERS[key] : "Not part of the example."}</p>
          </section>
        );
      })}
    </div>
  );
}

function ExampleTranscript({ config }: { config: PsyConfig }) {
  return (
    <ol className="flex flex-col gap-3">
      {config.questions.map((q, i) => (
        <li key={q.key}>
          <div className="text-[12px] font-semibold text-ink-900">Q{i + 1}. {q.title}</div>
          <div className="text-[11px] text-ink-500">Typed · English (UK) · example</div>
          <p className="mt-1 whitespace-pre-wrap text-[13px]">{EXAMPLE_ANSWERS[q.key]}</p>
        </li>
      ))}
    </ol>
  );
}

function ShareMenu({ note }: { note: PsyNote }) {
  const [open, setOpen] = useState(false);
  const [done, setDone] = useState("");
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    const onClick = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && setOpen(false);
    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onClick);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onClick);
    };
  }, [open]);
  const date = ddmmyyyy(note.session.session_date).split("/").reverse().join("-");
  async function act(label: string, work: () => Promise<boolean> | void) {
    const ok = await work();
    setDone(ok === false ? "Couldn't copy — select the text instead." : label);
    setOpen(false);
    window.setTimeout(() => setDone(""), 2500);
  }
  return (
    <div ref={ref} className="relative">
      <button type="button" className="mr-1 inline-flex items-center gap-1.5 rounded-[9px] border border-surface-border bg-surface-card px-[11px] py-[5px] text-[13px] font-semibold text-ink-900 hover:border-brand-green"
        aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <Share2 className="h-[15px] w-[15px]" /> Share
      </button>
      <span role="status" className="sr-only">{done}</span>
      {done && <span className="absolute right-0 top-full z-10 mt-1 whitespace-nowrap rounded-md bg-ink-900 px-2 py-1 text-[11px] text-surface-card">{done}</span>}
      {open && (
        <div role="menu" className="absolute right-0 top-full z-20 mt-1 w-52 rounded-lg border border-surface-border bg-surface-card p-1 shadow-md">
          <button type="button" role="menuitem" className="flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-[12.5px] hover:bg-surface-bg"
            onClick={() => void act("Note copied", () => copyText(note.rendered))}><Copy className="h-3.5 w-3.5" /> Copy note</button>
          <button type="button" role="menuitem" className="flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-[12.5px] hover:bg-surface-bg"
            onClick={() => void act("Transcript copied", () => copyText(transcriptText(note)))}><Copy className="h-3.5 w-3.5" /> Copy transcript</button>
          <button type="button" role="menuitem" className="flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-[12.5px] hover:bg-surface-bg"
            onClick={() => void act("Note downloaded", () => downloadText(`psychotherapy-note-${date}.txt`, note.rendered))}><Download className="h-3.5 w-3.5" /> Download note (.txt)</button>
        </div>
      )}
    </div>
  );
}

function ProcessingLine({ note }: { note: PsyNote }) {
  const p = note.processing;
  if (p.status === "pending") {
    return (
      <p role="status" className="flex animate-pulse items-center gap-1.5 text-[12px] text-ink-500">
        <span aria-hidden className="h-[7px] w-[7px] rounded-full bg-brand-green" />
        Processing…
      </p>
    );
  }
  return (
    <p className="flex items-center gap-1.5 text-[12px] text-ink-500">
      <span aria-hidden className={`h-[7px] w-[7px] flex-shrink-0 rounded-full ${p.status === "done" ? "bg-brand-green" : "bg-ink-500"}`} />
      {p.label}
      {p.status === "error" && <span className="text-priority-orange"> — the AI step did not complete, so your words are organised by rule.</span>}
      {p.reason && <span> — {p.reason}</span>}
    </p>
  );
}

function SessionInfo({ config, note, save }: { config: PsyConfig; note: PsyNote; save: Save }) {
  const s = note.session;
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({ when: toLocalInput(s.session_date), duration: String(s.duration_minutes ?? ""),
    mode: s.attendance_mode, type: s.session_type, location: s.location });
  const mode = config.attendance_modes.find((m) => m.code === s.attendance_mode)?.label;
  const type = config.session_types.find((t) => t.code === s.session_type)?.label ?? s.session_type;
  const locked = note.status === "SIGNED";
  async function submit() {
    const ok = await save({ session_date: form.when, duration_minutes: form.duration || null, attendance_mode: form.mode,
      session_type: form.type, location: form.location });
    if (ok) setEditing(false);
  }
  if (!editing) {
    return (
      <div className="flex items-start gap-2 font-sans text-[12.5px] text-ink-500">
        <div className="flex flex-1 flex-wrap gap-x-1.5">
        <span>{ddmmyyyy(s.session_date)} · {hhmm(s.session_date)}</span>
        <span>· {s.duration_minutes ? `${s.duration_minutes} min` : "duration not recorded"}</span>
        <span>· {mode ?? "format not recorded"}</span>
        <span>· {type}</span>
        <span>· {note.author}</span>
        {s.location && <span>· {s.location}</span>}
        </div>
        {!locked && note.is_author && (
          <button type="button" aria-label="Edit session information" title="Edit session information" onClick={() => setEditing(true)}
            className="grid h-7 w-7 flex-shrink-0 place-items-center rounded-[9px] text-ink-500 hover:bg-surface-bg hover:text-ink-900">
            <Pencil className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
    );
  }
  return (
    <fieldset className="grid grid-cols-1 gap-2 rounded-lg border border-surface-border p-2.5 font-sans sm:grid-cols-2">
      <legend className={`${FIELD_LABEL} px-1`}>Session information</legend>
      <label className="text-[12px]"><span className={FIELD_LABEL}>Date and start time</span>
        <input className={INPUT} type="datetime-local" value={form.when} onChange={(e) => setForm({ ...form, when: e.target.value })} /></label>
      <label className="text-[12px]"><span className={FIELD_LABEL}>Duration (minutes)</span>
        <input className={INPUT} type="number" min={1} max={600} value={form.duration} onChange={(e) => setForm({ ...form, duration: e.target.value })} /></label>
      <label className="text-[12px]"><span className={FIELD_LABEL}>Format</span>
        <select className={INPUT} value={form.mode} onChange={(e) => setForm({ ...form, mode: e.target.value })}>
          <option value="">— not recorded —</option>
          {config.attendance_modes.map((m) => <option key={m.code} value={m.code}>{m.label}</option>)}
        </select></label>
      <label className="text-[12px]"><span className={FIELD_LABEL}>Type</span>
        <select className={INPUT} value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}>
          {config.session_types.map((t) => <option key={t.code} value={t.code}>{t.label}</option>)}
          <option value="GROUP" disabled>Group psychotherapy — recorded in the group programme</option>
        </select></label>
      <label className="text-[12px]"><span className={FIELD_LABEL}>Clinician</span>
        <input className={INPUT} value={note.author} readOnly /></label>
      <label className="text-[12px]"><span className={FIELD_LABEL}>Location</span>
        <input className={INPUT} value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value })} /></label>
      <p className="text-[11px] text-ink-500 sm:col-span-2">Encounter {s.encounter.slice(0, 8).toUpperCase()} · one note per client — couple and family sessions are recorded for each person separately.</p>
      <div className="flex gap-2 sm:col-span-2">
        <button type="button" className={`${BTN} ${BTN_SM}`} onClick={() => void submit()}>Save</button>
        <button type="button" className={`${BTN_GHOST} ${BTN_SM}`} onClick={() => setEditing(false)}>Cancel</button>
      </div>
    </fieldset>
  );
}

function NoteBody({ config, note, save, organise, busy }: { config: PsyConfig; note: PsyNote; save: Save; organise: () => Promise<boolean>; busy: boolean }) {
  const signed = note.status === "SIGNED";
  const hasSections = Object.values(note.sections).some((v) => v);
  const hasAnswers = Object.values(note.answers).some((a) => a?.text?.trim());
  return (
    <div className="flex flex-col gap-[18px] font-doc text-[15.5px] leading-[1.55]">
      <SessionInfo config={config} note={note} save={save} />
      {!signed && !note.generated_at && hasAnswers && (
        <Callout tone="warning" className="font-sans">
          {hasSections ? "The answers changed since the note was organised." : "The note has not been organised yet."}
          <button type="button" className={`${BTN} ${BTN_SM} ml-2`} disabled={busy || !note.is_author} onClick={() => void organise()}>
            {hasSections ? "Update note" : "Organise note"}
          </button>
        </Callout>
      )}
      {NOTE_SECTIONS(config).map((s) => (
        <Section key={`${s.key}-${note.generated_at ?? ""}`} config={config} note={note} sectionKey={s.key} title={s.title} save={save} />
      ))}
      {note.watermark && hasSections && <p className="text-center text-[11px] font-bold uppercase tracking-wide text-priority-orange">{note.watermark}</p>}
    </div>
  );
}

/** Section text as the mockup lays it out: "- " lines become a bullet list,
 * a line ending in ":" a small subheading, anything else a paragraph. */
function NoteText({ text }: { text: string }) {
  const blocks: ReactNode[] = [];
  let items: string[] = [];
  const flush = () => {
    if (!items.length) return;
    const list = items;
    items = [];
    blocks.push(
      <ul key={`ul-${blocks.length}`} className="flex list-disc flex-col gap-[3px] pl-[18px]">
        {list.map((item, i) => <li key={i}>{item}</li>)}
      </ul>,
    );
  };
  for (const line of text.split("\n")) {
    const bullet = /^\s*[-•]\s+/.exec(line);
    if (bullet) {
      items.push(line.slice(bullet[0].length));
      continue;
    }
    flush();
    if (!line.trim()) continue;
    blocks.push(/:$/.test(line.trim())
      ? <div key={blocks.length} className="font-sans text-[12.5px] font-semibold text-ink-500">{line}</div>
      : <p key={blocks.length} className="whitespace-pre-wrap">{line}</p>);
  }
  flush();
  return <div className="flex flex-col gap-[5px] text-ink-900">{blocks}</div>;
}

function Section({ config, note, sectionKey, title, save }: { config: PsyConfig; note: PsyNote; sectionKey: string; title: string; save: Save }) {
  // eslint-disable-next-line security/detect-object-injection -- section key from the served config.
  const text = note.sections[sectionKey] ?? "";
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(text);
  const signed = note.status === "SIGNED";
  const edited = note.edited_sections.includes(sectionKey);
  // eslint-disable-next-line security/detect-object-injection -- section key from the served config.
  const source = note.processing.sections[sectionKey]?.source;
  const flags = note.flags.filter((f) => f.where === `section:${sectionKey}`);
  const amendments = note.amendments.filter((a) => a.section === sectionKey);
  const canEdit = !signed && note.is_author && !!note.generated_at;
  void config;
  async function submit() {
    if (await save({ sections: { [sectionKey]: draft } })) setEditing(false);
  }
  return (
    <section aria-labelledby={`psy-sec-${sectionKey}`} className="flex flex-col gap-[5px]">
      <div className="flex flex-wrap items-center justify-between gap-2 font-sans">
        <div className="flex items-center gap-1.5">
          <h3 id={`psy-sec-${sectionKey}`} className={SEC_H}>{title}</h3>
          {edited && <Tag tone="brand">Edited</Tag>}
          {!edited && source === "ai" && <Tag>Reworded</Tag>}
          {amendments.length > 0 && <Tag tone="warn">Amended</Tag>}
        </div>
        {canEdit && !editing && (
          <div className="flex gap-2.5">
            {edited && <button type="button" className={LINK} onClick={() => void save({ revert_section: sectionKey })}>Revert</button>}
            <button type="button" className={LINK} onClick={() => { setDraft(text); setEditing(true); }}>Edit</button>
          </div>
        )}
      </div>
      {editing ? (
        <div className="mt-1.5 flex flex-col gap-1.5">
          <textarea className={`${INPUT} min-h-[130px] font-doc text-[15px] leading-normal`} aria-label={`Edit ${title}`} rows={Math.min(14, Math.max(4, draft.split("\n").length + 1))}
            value={draft} onChange={(e) => setDraft(e.target.value)} />
          <div className="flex gap-1.5">
            <button type="button" className={`${BTN} ${BTN_SM}`} onClick={() => void submit()}>Save</button>
            <button type="button" className={`${BTN_GHOST} ${BTN_SM}`} onClick={() => setEditing(false)}>Cancel</button>
          </div>
        </div>
      ) : (
        text ? <NoteText text={text} />
          : <p className="italic text-ink-500">{note.generated_at ? "Not documented this session." : "Not organised yet."}</p>
      )}
      {flags.map((f, i) => <p key={i} className="font-sans text-[12px] text-priority-orange">Language suggestion: “{f.term}” — {f.suggestion}</p>)}
      {amendments.map((a) => (
        <p key={a.id} className="border-l-2 border-brand-green pl-2.5 font-sans text-[11.5px] text-ink-500">Amended {formatDateTime(a.at)} by {a.by} — {a.reason}</p>
      ))}
    </section>
  );
}

function Transcript({ config, note }: { config: PsyConfig; note: PsyNote }) {
  const languages = new Map(config.languages.map((l) => [l.code, l.label]));
  return (
    <ol className="flex flex-col gap-4">
      {note.transcript.map((t, i) => (
        <li key={t.question}>
          <div className="text-[12.5px] font-semibold text-ink-900">Q{i + 1}. {t.title}</div>
          <div className="text-[11px] text-ink-500">
            {modeLabel(t.mode)}{t.answered_at ? ` · ${hhmm(t.answered_at)}` : ""} · {languages.get(t.language) ?? t.language}
          </div>
          <p className="mt-1 whitespace-pre-wrap text-[13px]">{t.text || <span className="text-ink-500">Not answered.</span>}</p>
          {t.translation && (
            <div className="mt-1.5 rounded-md border-l-[3px] border-brand-green bg-surface-bg px-2.5 py-1.5">
              <div className={FIELD_LABEL}>English translation</div>
              {t.translation.status === "done" && (
                <>
                  <p className="whitespace-pre-wrap text-[13px]">{t.translation.text}</p>
                  <p className="text-[11px] text-ink-500">Machine translation · {t.translation.model} · {formatDateTime(t.translation.at)} — the clinician’s original words above are the record.</p>
                </>
              )}
              {t.translation.status === "pending" && <p className="animate-pulse text-[12.5px] text-ink-500">Translating…</p>}
              {(t.translation.status === "unavailable" || t.translation.status === "error") && (
                <p className="text-[12.5px] text-ink-500">{config.processed_labels.not_translated}.</p>
              )}
            </div>
          )}
        </li>
      ))}
    </ol>
  );
}

function SignFooter({ config, note, save, sign, busy }: { config: PsyConfig; note: PsyNote; save: Save; sign: () => Promise<boolean>; busy: boolean }) {
  const [open, setOpen] = useState(true);
  const list = note.checklist;
  const ready = note.blockers.length === 0;
  const na = note.safety_answer === "NOT_ASSESSED";
  return (
    <div className="flex max-h-[45%] flex-shrink-0 flex-col gap-2.5 overflow-y-auto border-t border-surface-border px-[18px] pb-3.5 pt-3 text-[13.5px]">
      {list && (
        <div>
          <button type="button" aria-expanded={open} aria-controls="psy-checklist" onClick={() => setOpen((o) => !o)}
            className="flex w-full items-center justify-between gap-2 text-left text-[13px] text-ink-500">
            <span>Before signing</span>
            <span className="inline-flex items-center gap-1">{list.done} of {list.total} complete
              <ChevronDown className={`h-3.5 w-3.5 transition-transform ${open ? "rotate-180" : ""}`} /></span>
          </button>
          {open && (
            <ul id="psy-checklist" className="mt-2 flex flex-col gap-[5px]">
              {list.items.map((item) => (
                <li key={item.key} className="grid grid-cols-[18px_1fr] gap-1.5 text-[13px]">
                  <span aria-hidden className={item.done ? "text-brand-green" : "text-ink-500"}>{item.done ? "✓" : "○"}</span>
                  <span>
                    <span className="sr-only">{item.done ? "Done: " : "Not done: "}</span>
                    {item.label}{item.detail && item.key !== "attestation" ? ` (${item.detail})` : ""}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
      {na && !note.safety_ack && (
        <label className="flex items-start gap-2 text-[12.5px]">
          <input type="checkbox" className="mt-0.5" checked={false} disabled={!note.not_assessed_reason || !note.is_author}
            onChange={(e) => e.target.checked && void save({ acknowledge_not_assessed: { acknowledged: true } })} />
          <span>{config.not_assessed_ack_text}{!note.not_assessed_reason && <span className="block text-[11px] text-ink-500">Give the reason in the conversation first.</span>}</span>
        </label>
      )}
      {na && note.safety_ack && <p className="text-[12px] text-ink-500">Acknowledged by {note.safety_ack.by}: {note.safety_ack.reason}</p>}
      <label className="flex items-start gap-2 text-[12.5px]">
        <input type="checkbox" className="mt-0.5" checked={note.accuracy_confirmed} disabled={!note.generated_at || !note.is_author || note.processing.status === "pending"}
          onChange={(e) => void save({ accuracy_confirmed: e.target.checked })} />
        <span>{config.attestation_text}</span>
      </label>
      <div className="flex flex-wrap gap-2">
        <button type="button" disabled={!ready || busy || !note.is_author} onClick={() => void sign()}
          title={ready ? undefined : note.blockers.map((b) => b.text).join("\n")}
          className="flex-1 rounded-[11px] bg-brand-green p-2.5 text-[13.5px] font-semibold text-on-primary disabled:cursor-not-allowed disabled:bg-surface-bg disabled:text-ink-500">Sign note</button>
        <button type="button" className="rounded-[10px] border border-surface-border bg-surface-card px-3.5 py-2 text-[13.5px] font-medium hover:border-brand-green" onClick={() => void copyText(note.rendered)}>Copy</button>
      </div>
      {!ready && <p className="text-[11px] text-ink-500">{note.blockers[0]?.text}</p>}
    </div>
  );
}

function SignedFooter({ config, note, amend }: { config: PsyConfig; note: PsyNote; amend: (b: { section: string; text: string; reason: string }) => Promise<boolean> }) {
  const [open, setOpen] = useState(false);
  const sections = NOTE_SECTIONS(config);
  const [section, setSection] = useState(sections[0]?.key ?? "");
  // eslint-disable-next-line security/detect-object-injection -- section key from the served config.
  const [text, setText] = useState(note.sections[section] ?? "");
  const [reason, setReason] = useState("");
  async function submit() {
    if (await amend({ section, text, reason })) {
      setOpen(false);
      setReason("");
    }
  }
  return (
    <div className="flex flex-col gap-2 border-t border-surface-border px-4 py-3">
      <p className="text-[12px] text-ink-500">Signed by {note.author} · {formatDateTime(note.signed_at)}. A signed note is locked — changes are dated, named amendments.</p>
      {open && (
        <div className="flex flex-col gap-1.5">
          <select className={INPUT} aria-label="Section to amend" value={section}
             
            onChange={(e) => { setSection(e.target.value); setText(note.sections[e.target.value] ?? ""); }}>
            {sections.map((s) => <option key={s.key} value={s.key}>{s.title}</option>)}
          </select>
          <textarea className={INPUT} rows={4} aria-label="Amended text" value={text} onChange={(e) => setText(e.target.value)} />
          <input className={INPUT} aria-label="Reason for the amendment" placeholder="Reason for the amendment (required)" value={reason} onChange={(e) => setReason(e.target.value)} />
          <div className="flex gap-2">
            <button type="button" className={`${BTN} ${BTN_SM}`} disabled={reason.trim().length < 3} onClick={() => void submit()}>Save amendment</button>
            <button type="button" className={`${BTN_GHOST} ${BTN_SM}`} onClick={() => setOpen(false)}>Cancel</button>
          </div>
        </div>
      )}
      <div className="flex gap-2">
        {!open && <button type="button" className={`${BTN} ${BTN_SM}`} onClick={() => setOpen(true)}>Add amendment</button>}
        <button type="button" className={`${BTN_GHOST} ${BTN_SM}`} onClick={() => void copyText(note.rendered)}><Copy className="h-3.5 w-3.5" /> Copy</button>
      </div>
    </div>
  );
}
