import { Check, ChevronDown, Copy, Download, Share2 } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import type { PsyConfig, PsyNote } from "../../../../../lib/psychotherapyNoteApi";
import { formatDateTime } from "../../../shared/format";
import { BTN, BTN_GHOST, BTN_SM, FIELD_LABEL, INPUT } from "../../../shared/styles";
import { Callout, Tag } from "../../../shared/ui";
import { EXAMPLE_ANSWERS, EXAMPLE_SECTION } from "./exampleSession";
import { copyText, ddmmyyyy, downloadText, hhmm, modeLabel, toLocalInput, transcriptText } from "./helpers";

type Save = (body: Record<string, unknown>) => Promise<boolean>;

const NOTE_SECTIONS = (config: PsyConfig) => config.sections.filter((s) => s.key !== "session_information");

function StatusPill({ signed, example }: { signed: boolean; example?: boolean }) {
  if (example) return <span className="rounded-full bg-priority-orange-tint px-2 py-0.5 text-[10.5px] font-bold uppercase tracking-wide text-priority-orange">Example — not saved</span>;
  return signed
    ? <span className="rounded-full bg-brand-green-tint px-2 py-0.5 text-[10.5px] font-bold uppercase tracking-wide text-brand-green">Signed</span>
    : <span className="rounded-full bg-priority-orange-tint px-2 py-0.5 text-[10.5px] font-bold uppercase tracking-wide text-priority-orange">Draft — review required</span>;
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
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-surface-border px-4 py-2.5">
        <div className="flex items-center gap-2">
          <h2 className="text-sm font-bold text-ink-900">Therapy note</h2>
          <StatusPill signed={signed} example={example} />
        </div>
        <div className="flex items-center gap-1">
          {!example && <ShareMenu note={note} />}
          {controls}
        </div>
      </div>
      <div role="tablist" aria-label="Therapy note views" className="flex gap-1 border-b border-surface-border px-4">
        {(["note", "transcript"] as const).map((t) => (
          <button key={t} type="button" role="tab" aria-selected={tab === t} id={`psy-tab-${t}`} aria-controls={`psy-panel-${t}`}
            onClick={() => setTab(t)}
            className={`-mb-px border-b-2 px-2.5 py-2 text-[12.5px] font-semibold ${tab === t ? "border-brand-green text-brand-green" : "border-transparent text-ink-500 hover:text-ink-900"}`}>
            {t === "note" ? "Note" : "Transcript"}
          </button>
        ))}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3" role="tabpanel" id={`psy-panel-${tab}`} aria-labelledby={`psy-tab-${tab}`}>
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
    <div className="flex flex-col gap-3">
      <Callout tone="warning">Example — not saved. The answers are placed under the section each question feeds; a real session is organised by the server and reviewed by you.</Callout>
      {NOTE_SECTIONS(config).map((s) => {
        // eslint-disable-next-line security/detect-object-injection -- question / section key from the fixed example map.
        const key = Object.keys(EXAMPLE_SECTION).find((k) => EXAMPLE_SECTION[k] === s.key);
        return (
          <section key={s.key}>
            <h3 className={FIELD_LABEL}>{s.title}</h3>
            {/* eslint-disable-next-line security/detect-object-injection -- question / section key from the fixed example map. */}
            <p className="mt-1 whitespace-pre-wrap text-[13px] text-ink-900">{key ? EXAMPLE_ANSWERS[key] : "Not part of the example."}</p>
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
      <button type="button" className={`${BTN_GHOST} ${BTN_SM}`} aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <Share2 className="h-3.5 w-3.5" /> Share
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
      <p role="status" className="animate-pulse rounded-md bg-surface-bg px-2.5 py-1.5 text-[12px] text-ink-500">
        Processing… the note shows the organised text until the trauma-informed wording is ready.
      </p>
    );
  }
  return (
    <p className="text-[12px] text-ink-500">
      {p.label}
      {p.status === "error" && <span className="text-priority-orange"> — the AI step did not complete, so your words are organised by rule.</span>}
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
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[12px] text-ink-700">
        <span>{ddmmyyyy(s.session_date)} · {hhmm(s.session_date)}</span>
        <span>· {s.duration_minutes ? `${s.duration_minutes} min` : "duration not recorded"}</span>
        <span>· {mode ?? "format not recorded"}</span>
        <span>· {type}</span>
        <span>· {note.author}</span>
        {s.location && <span>· {s.location}</span>}
        {!locked && note.is_author && (
          <button type="button" className="font-semibold text-brand-green underline-offset-2 hover:underline" onClick={() => setEditing(true)}>Edit</button>
        )}
      </div>
    );
  }
  return (
    <fieldset className="grid grid-cols-1 gap-2 rounded-lg border border-surface-border p-2.5 sm:grid-cols-2">
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
    <div className="flex flex-col gap-3">
      <ProcessingLine note={note} />
      <SessionInfo config={config} note={note} save={save} />
      {!signed && !note.generated_at && hasAnswers && (
        <Callout tone="warning">
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
    <section aria-labelledby={`psy-sec-${sectionKey}`} className="rounded-lg border border-surface-border p-2.5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-1.5">
          <h3 id={`psy-sec-${sectionKey}`} className={FIELD_LABEL}>{title}</h3>
          {edited && <Tag tone="brand">Edited</Tag>}
          {!edited && source === "ai" && <Tag>Reworded</Tag>}
          {amendments.length > 0 && <Tag tone="warn">Amended</Tag>}
        </div>
        {canEdit && !editing && (
          <div className="flex gap-1">
            <button type="button" className={`${BTN_GHOST} ${BTN_SM}`} onClick={() => { setDraft(text); setEditing(true); }}>Edit</button>
            {edited && <button type="button" className={`${BTN_GHOST} ${BTN_SM}`} onClick={() => void save({ revert_section: sectionKey })}>Revert</button>}
          </div>
        )}
      </div>
      {editing ? (
        <div className="mt-1.5 flex flex-col gap-1.5">
          <textarea className={INPUT} aria-label={`Edit ${title}`} rows={Math.min(14, Math.max(4, draft.split("\n").length + 1))}
            value={draft} onChange={(e) => setDraft(e.target.value)} />
          <div className="flex gap-1.5">
            <button type="button" className={`${BTN} ${BTN_SM}`} onClick={() => void submit()}>Save</button>
            <button type="button" className={`${BTN_GHOST} ${BTN_SM}`} onClick={() => setEditing(false)}>Cancel</button>
          </div>
        </div>
      ) : (
        <p className="mt-1 whitespace-pre-wrap text-[13px] leading-relaxed text-ink-900">{text || <span className="text-ink-500">Not organised yet.</span>}</p>
      )}
      {flags.map((f, i) => <p key={i} className="mt-1 text-[12px] text-priority-orange">Language suggestion: “{f.term}” — {f.suggestion}</p>)}
      {amendments.map((a) => (
        <p key={a.id} className="mt-1 text-[11.5px] text-ink-500">Amended {formatDateTime(a.at)} by {a.by} — {a.reason}</p>
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
  const [open, setOpen] = useState(false);
  const list = note.checklist;
  const ready = note.blockers.length === 0;
  const na = note.safety_answer === "NOT_ASSESSED";
  return (
    <div className="flex flex-col gap-2 border-t border-surface-border px-4 py-3">
      {list && (
        <div>
          <button type="button" aria-expanded={open} aria-controls="psy-checklist" onClick={() => setOpen((o) => !o)}
            className="flex w-full items-center justify-between text-left text-[12.5px] font-semibold text-ink-900">
            Before signing — {list.done} of {list.total} complete
            <ChevronDown className={`h-4 w-4 transition-transform ${open ? "rotate-180" : ""}`} />
          </button>
          {open && (
            <ul id="psy-checklist" className="mt-1.5 flex flex-col gap-1">
              {list.items.map((item) => (
                <li key={item.key} className="flex items-start gap-2 text-[12px]">
                  <span aria-hidden className={`mt-0.5 flex h-4 w-4 flex-shrink-0 items-center justify-center rounded-full ${item.done ? "bg-brand-green text-on-primary" : "border border-surface-border"}`}>
                    {item.done && <Check className="h-3 w-3" />}
                  </span>
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
        <button type="button" className={`${BTN} ${BTN_SM}`} disabled={!ready || busy || !note.is_author} onClick={() => void sign()}
          title={ready ? undefined : note.blockers.map((b) => b.text).join("\n")}>Sign note</button>
        <button type="button" className={`${BTN_GHOST} ${BTN_SM}`} onClick={() => void copyText(note.rendered)}><Copy className="h-3.5 w-3.5" /> Copy</button>
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
