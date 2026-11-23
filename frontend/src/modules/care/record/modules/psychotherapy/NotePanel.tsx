import { AutoResizeTextarea } from "../../../shared/AutoResizeTextarea";
import { ChevronDown, ClipboardCheck, Copy, Pencil } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { useAuth } from "../../../../../auth/useAuth";
import type { PsyConfig, PsyNote } from "../../../../../lib/psychotherapyNoteApi";
import {
  getPsychotherapyPlanSchedule,
  schedulePsychotherapySession,
  type PsychotherapyPlanSchedule,
} from "../../../../../lib/carePathwayApi";
import { formatDateTime } from "../../../shared/format";
import { BTN, BTN_GHOST, BTN_SM, FIELD_LABEL, INPUT } from "../../../shared/styles";
import { Callout, Tag } from "../../../shared/ui";
import { useValueSets } from "../../../shared/useValueSets";
import { exampleAnswers, exampleSections } from "./exampleSession";
import {
  copyText,
  ddmmyyyy,
  familyDraftDisplayText,
  hhmm,
  modeLabel,
  noteSections,
  toLocalInput,
} from "./helpers";

type Save = (body: Record<string, unknown>) => Promise<boolean>;

const STATUS =
  "whitespace-nowrap rounded-[5px] px-[7px] py-[3px] font-mono text-[10.5px] font-medium uppercase tracking-[.06em]";
/** Section heading: small, quiet capitals; the content carries the weight. */
const SEC_H = "text-[13.5px] font-semibold text-ink-900";
const LINK = "text-[12px] text-ink-500 underline underline-offset-2 hover:text-ink-900";

function StatusPill({
  signed,
  example,
  family,
}: {
  signed: boolean;
  example?: boolean;
  family?: boolean;
}) {
  if (example)
    return (
      <span className={`${STATUS} bg-priority-orange-tint text-priority-orange`}>
        Example — not saved
      </span>
    );
  return signed ? (
    <span className={`${STATUS} bg-brand-green-tint text-brand-green`}>
      {family ? "Submitted" : "Signed"}
    </span>
  ) : (
    <span className={`${STATUS} bg-priority-orange-tint text-priority-orange`}>
      {family ? "Draft — submission required" : "Draft — review required"}
    </span>
  );
}

/** The therapy-note panel: Note | Transcript, section editing, the sign-off
 * checklist and signing; amendments once signed. Every rule is the server's. */
export function NotePanel({
  config,
  note,
  save,
  organise,
  sign,
  amend,
  controls,
  example,
  busy,
  onEditAnswer,
  onSelfAssessment,
  patientId,
}: {
  config: PsyConfig;
  note: PsyNote;
  save: Save;
  organise: () => Promise<boolean>;
  sign: () => Promise<boolean>;
  amend: (body: { section: string; text: string; reason: string }) => Promise<boolean>;
  controls: ReactNode;
  example: boolean;
  busy: boolean;
  onEditAnswer?: (key: string) => void;
  onSelfAssessment?: () => void;
  patientId?: string;
}) {
  // Until the clinician picks a view, a draft shows what has been captured in
  // the transcript; once the note is organised the note itself leads.
  const [chosen, setChosen] = useState<"note" | "transcript" | null>(null);
  const tab = chosen ?? (example || note.generated_at ? "note" : "transcript");
  const signed = note.status === "SIGNED";
  const noteText = example
    ? exampleText(config, note.session.session_type)
    : familyDraftDisplayText(note, note.rendered);
  // Keep the newest captured answer in view as the session moves on.
  const bodyRef = useRef<HTMLDivElement>(null);
  const answered = note.transcript.filter((t) => t.text.trim() !== "").length;
  useEffect(() => {
    if (example || tab !== "transcript") return;
    const el = bodyRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [answered, example, tab]);
  return (
    <div className="flex h-full min-h-0 flex-col bg-surface-card">
      <div className="flex flex-col gap-2.5 border-b border-surface-border px-[18px] pb-2.5 pt-3.5">
        <div className="flex flex-wrap items-center gap-x-2.5 gap-y-2">
          <h2 className="whitespace-nowrap text-[15px] font-semibold text-ink-900">
            {note.session.session_type === "FAMILY" ? "Family psychotherapy note" : "Therapy note"}
          </h2>
          <StatusPill
            signed={signed}
            example={example}
            family={note.session.session_type === "FAMILY"}
          />
          <div className="ml-auto flex items-center gap-0.5">{controls}</div>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div
            role="tablist"
            aria-label={
              note.session.session_type === "FAMILY"
                ? "Family psychotherapy note views"
                : "Therapy note views"
            }
            className="flex gap-0.5 rounded-[9px] bg-surface-bg p-[3px]"
          >
            {(["note", "transcript"] as const).map((t) => (
              <button
                key={t}
                type="button"
                role="tab"
                aria-selected={tab === t}
                id={`psy-tab-${t}`}
                aria-controls={`psy-panel-${t}`}
                onClick={() => setChosen(t)}
                className={`rounded-[7px] px-3 py-1 text-[12.5px] font-semibold ${tab === t ? "bg-surface-card text-ink-900 shadow-sm" : "text-ink-500 hover:text-ink-900"}`}
              >
                {t === "note" ? "Note" : "Transcript"}
              </button>
            ))}
          </div>
          {!example && <ProcessingLine note={note} />}
        </div>
      </div>
      <div
        ref={bodyRef}
        className="min-h-0 flex-1 overflow-y-auto px-5 pb-5 pt-4"
        role="tabpanel"
        id={`psy-panel-${tab}`}
        aria-labelledby={`psy-tab-${tab}`}
      >
        {example ? (
          tab === "note" ? (
            <ExamplePreview config={config} note={note} />
          ) : (
            <ExampleTranscript config={config} note={note} />
          )
        ) : tab === "note" ? (
          <NoteBody
            config={config}
            note={note}
            save={save}
            organise={organise}
            busy={busy}
            patientId={patientId}
          />
        ) : (
          <Transcript config={config} note={note} onEditAnswer={onEditAnswer} />
        )}
      </div>
      {example ? (
        <div className="border-t border-surface-border px-4 py-3 text-[12px] text-ink-500">
          This is an example to show how the workspace works. It is not saved and cannot be signed.
          <button
            type="button"
            className={`${BTN_GHOST} ${BTN_SM} ml-2`}
            onClick={() => void copyText(noteText)}
          >
            <Copy className="h-3.5 w-3.5" /> Copy
          </button>
        </div>
      ) : signed ? (
        <SignedFooter
          config={config}
          note={note}
          amend={amend}
          onSelfAssessment={note.session.session_type === "FAMILY" ? undefined : onSelfAssessment}
        />
      ) : (
        <SignFooter config={config} note={note} save={save} sign={sign} busy={busy} />
      )}
    </div>
  );
}

function exampleText(config: PsyConfig, sessionType: string) {
  const answers = exampleAnswers(sessionType);
  const sections = exampleSections(sessionType);
  return noteSections(config, sessionType)
    .map((s) => {
      const key = Object.entries(sections).find(([, sectionKey]) => sectionKey === s.key)?.[0];
      // eslint-disable-next-line security/detect-object-injection -- question / section key from the fixed example map.
      return `${s.title}\n${key ? answers[key] : "Not part of the example."}`;
    })
    .join("\n\n");
}

function ExamplePreview({ config, note }: { config: PsyConfig; note: PsyNote }) {
  const answers = exampleAnswers(note.session.session_type);
  const sections = exampleSections(note.session.session_type);
  return (
    <div className="flex flex-col gap-3">
      <Callout tone="warning">
        Example — not saved. The answers are placed under the section each question feeds; a real
        session is organised by the server and reviewed by you.
      </Callout>
      {noteSections(config, note.session.session_type).map((s) => {
        const key = Object.entries(sections).find(([, sectionKey]) => sectionKey === s.key)?.[0];
        // eslint-disable-next-line security/detect-object-injection -- key comes from the fixed example section map.
        const answer = key ? answers[key] : "Not part of the example.";
        return (
          <section key={s.key}>
            <h3 className={SEC_H}>{s.title}</h3>
            <p className="mt-1 whitespace-pre-wrap text-[13px] leading-[1.5] text-ink-900">
              {answer}
            </p>
          </section>
        );
      })}
    </div>
  );
}

function ExampleTranscript({ config, note }: { config: PsyConfig; note: PsyNote }) {
  const answers = exampleAnswers(note.session.session_type);
  return (
    <ol className="flex flex-col gap-3">
      {config.questions.map((q, i) => (
        <li key={q.key}>
          <div className="text-[12px] font-semibold text-ink-900">
            Q{i + 1}. {q.title}
          </div>
          <div className="text-[11px] text-ink-500">Typed · English (UK) · example</div>
          <p className="mt-1 whitespace-pre-wrap text-[13px]">{answers[q.key]}</p>
        </li>
      ))}
    </ol>
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
  // Only said when something is happening or went wrong; a normal note says nothing.
  if (p.status !== "error") return null;
  return (
    <p className="flex items-center gap-1.5 text-[12px] text-ink-500">
      <span aria-hidden className="h-[7px] w-[7px] flex-shrink-0 rounded-full bg-ink-500" />
      {p.label}
      {p.status === "error" && (
        <span className="text-priority-orange">
          {" "}
          — the AI step did not complete, so your words are organised by rule.
        </span>
      )}
      {p.reason && <span> — {p.reason}</span>}
    </p>
  );
}

function SessionInfo({ config, note, save }: { config: PsyConfig; note: PsyNote; save: Save }) {
  const s = note.session;
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({
    when: toLocalInput(s.session_date),
    duration: String(s.duration_minutes ?? ""),
    mode: s.attendance_mode,
    type: s.session_type,
    location: s.location,
    session_objective: s.session_objective ?? "",
    primary_goal: s.primary_goal ?? "",
    secondary_goals: s.secondary_goals ?? "",
    goals: [s.primary_goal, s.secondary_goals].filter(Boolean).join("\n"),
  });
  const mode = config.attendance_modes.find((m) => m.code === s.attendance_mode)?.label;
  const type = config.session_types.find((t) => t.code === s.session_type)?.label ?? s.session_type;
  const locked = note.status === "SIGNED";
  async function submit() {
    const ok = await save({
      session_date: form.when,
      duration_minutes: form.duration || null,
      attendance_mode: form.mode,
      session_type: s.session_type === "FAMILY" ? s.session_type : form.type,
      location: form.location,
      session_objective: form.session_objective,
      ...(s.session_type === "FAMILY"
        ? { primary_goal: form.goals, secondary_goals: "" }
        : { primary_goal: form.primary_goal, secondary_goals: form.secondary_goals }),
    });
    if (ok) setEditing(false);
  }
  if (!editing) {
    return (
      <div className="flex items-start gap-2 text-[12.5px] text-ink-500">
        <div className="flex flex-1 flex-wrap gap-x-1.5">
          <span>
            {ddmmyyyy(s.session_date)} · {hhmm(s.session_date)}
          </span>
          {s.duration_minutes ? <span>· {s.duration_minutes} min</span> : null}
          {mode ? <span>· {mode}</span> : null}
          <span>· {type}</span>
          <span>· {note.author}</span>
          {s.location && <span>· {s.location}</span>}
          {s.session_type !== "FAMILY" && s.session_objective && (
            <span className="block">Objective: {s.session_objective}</span>
          )}
          {s.session_type === "FAMILY" ? (
            [s.primary_goal, s.secondary_goals].filter(Boolean).length > 0 && (
              <span className="block whitespace-pre-line">
                Goals: {[s.primary_goal, s.secondary_goals].filter(Boolean).join("\n")}
              </span>
            )
          ) : (
            <>
              {s.primary_goal && <span className="block">Primary goal: {s.primary_goal}</span>}
              {s.secondary_goals && (
                <span className="block">Secondary goals: {s.secondary_goals}</span>
              )}
            </>
          )}
        </div>
        {!locked && note.is_author && (
          <button
            type="button"
            aria-label="Edit session information"
            title="Edit session information"
            onClick={() => setEditing(true)}
            className="grid h-7 w-7 flex-shrink-0 place-items-center rounded-[9px] text-ink-500 hover:bg-surface-bg hover:text-ink-900"
          >
            <Pencil className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
    );
  }
  return (
    <fieldset className="grid grid-cols-1 gap-2 rounded-lg border border-surface-border p-2.5 sm:grid-cols-2">
      <legend className={`${FIELD_LABEL} px-1`}>Session information</legend>
      <label className="text-[12px]">
        <span className={FIELD_LABEL}>Date and start time</span>
        <input
          className={INPUT}
          type="datetime-local"
          value={form.when}
          onChange={(e) => setForm({ ...form, when: e.target.value })}
        />
      </label>
      <label className="text-[12px]">
        <span className={FIELD_LABEL}>Duration (minutes)</span>
        <input
          className={INPUT}
          type="number"
          min={1}
          max={600}
          value={form.duration}
          onChange={(e) => setForm({ ...form, duration: e.target.value })}
        />
      </label>
      <label className="text-[12px]">
        <span className={FIELD_LABEL}>Format</span>
        <select
          className={INPUT}
          value={form.mode}
          onChange={(e) => setForm({ ...form, mode: e.target.value })}
        >
          <option value="">— not recorded —</option>
          {config.attendance_modes
            .filter((m) => !note.inpatient || m.code === "IN_PERSON")
            .map((m) => (
              <option key={m.code} value={m.code}>
                {m.label}
              </option>
            ))}
        </select>
      </label>
      <label className="text-[12px]">
        <span className={FIELD_LABEL}>Type</span>
        {s.session_type === "FAMILY" ? (
          <div className={INPUT}>Family</div>
        ) : (
          <select
            className={INPUT}
            value={form.type}
            onChange={(e) => setForm({ ...form, type: e.target.value })}
          >
            {config.session_types.map((t) => (
              <option key={t.code} value={t.code}>
                {t.label}
              </option>
            ))}
            <option value="GROUP" disabled>
              Group psychotherapy — recorded in the group programme
            </option>
          </select>
        )}
      </label>
      <label className="text-[12px]">
        <span className={FIELD_LABEL}>Clinician</span>
        <input className={INPUT} value={note.author} readOnly />
      </label>
      <label className="text-[12px]">
        <span className={FIELD_LABEL}>Location</span>
        <input
          className={INPUT}
          value={form.location}
          onChange={(e) => setForm({ ...form, location: e.target.value })}
        />
      </label>
      {s.session_type !== "FAMILY" && (
        <label className="text-[12px] sm:col-span-2">
          <span className={FIELD_LABEL}>Session objective</span>
          <AutoResizeTextarea
            className={INPUT}
            rows={2}
            value={form.session_objective}
            onChange={(e) => setForm({ ...form, session_objective: e.target.value })}
          />
        </label>
      )}
      {s.session_type === "FAMILY" ? (
        <label className="text-[12px] sm:col-span-2">
          <span className={FIELD_LABEL}>Goals</span>
          <AutoResizeTextarea
            className={INPUT}
            rows={3}
            value={form.goals}
            onChange={(e) => setForm({ ...form, goals: e.target.value })}
          />
        </label>
      ) : (
        <>
          <label className="text-[12px] sm:col-span-2">
            <span className={FIELD_LABEL}>Primary goal</span>
            <AutoResizeTextarea
              className={INPUT}
              rows={2}
              value={form.primary_goal}
              onChange={(e) => setForm({ ...form, primary_goal: e.target.value })}
            />
          </label>
          <label className="text-[12px] sm:col-span-2">
            <span className={FIELD_LABEL}>Secondary goals</span>
            <AutoResizeTextarea
              className={INPUT}
              rows={2}
              value={form.secondary_goals}
              onChange={(e) => setForm({ ...form, secondary_goals: e.target.value })}
            />
          </label>
        </>
      )}
      <p className="text-[11px] text-ink-500 sm:col-span-2">
        Encounter {s.encounter.slice(0, 8).toUpperCase()} · one note per client — couple and family
        sessions are recorded for each person separately.
      </p>
      <div className="flex gap-2 sm:col-span-2">
        <button type="button" className={`${BTN} ${BTN_SM}`} onClick={() => void submit()}>
          Save
        </button>
        <button
          type="button"
          className={`${BTN_GHOST} ${BTN_SM}`}
          onClick={() => setEditing(false)}
        >
          Cancel
        </button>
      </div>
    </fieldset>
  );
}

function NoteBody({
  config,
  note,
  save,
  organise,
  busy,
  patientId,
}: {
  config: PsyConfig;
  note: PsyNote;
  save: Save;
  organise: () => Promise<boolean>;
  busy: boolean;
  patientId?: string;
}) {
  const signed = note.status === "SIGNED";
  const hasSections = Object.values(note.sections).some((v) => v);
  const hasAnswers = Object.values(note.answers).some((a) => a?.text?.trim());
  return (
    <div className="flex flex-col gap-2.5 text-[13px] leading-[1.5]">
      <SessionInfo config={config} note={note} save={save} />
      {!signed && !note.generated_at && hasAnswers && (
        <Callout tone="warning">
          {hasSections
            ? "The answers changed since the note was organised."
            : "The note has not been organised yet."}
          <button
            type="button"
            className={`${BTN} ${BTN_SM} ml-2`}
            disabled={busy || !note.is_author}
            onClick={() => void organise()}
          >
            {hasSections ? "Update note" : "Organise note"}
          </button>
        </Callout>
      )}
      {noteSections(config, note.session.session_type).map((s) => (
        <Section
          key={`${s.key}-${note.generated_at ?? ""}`}
          config={config}
          note={note}
          sectionKey={s.key}
          title={s.title}
          save={save}
        />
      ))}
      {note.watermark && hasSections && (
        <p className="border-t border-surface-border pt-3 text-center text-[10.5px] font-semibold uppercase tracking-wide text-priority-orange">
          {note.watermark}
        </p>
      )}
      {/* The next session is booked at the end of this one, once the note is signed. */}
      {patientId && signed && (
        <PsychotherapyPlanCard
          patientId={patientId}
          fixedAppointmentType={
            note.session.session_type === "FAMILY" ? "Family psychotherapy" : undefined
          }
        />
      )}
    </div>
  );
}

/** Section text as the mockup lays it out: "- " lines become a bullet list,
 * a line ending in ":" a small subheading, anything else a paragraph. */
export function NoteText({ text }: { text: string }) {
  const blocks: ReactNode[] = [];
  let items: string[] = [];
  const flush = () => {
    if (!items.length) return;
    const list = items;
    items = [];
    // A single point reads as a sentence, not a one-item list.
    if (list.length === 1) {
      blocks.push(
        <p key={`p-${blocks.length}`} className="whitespace-pre-wrap">
          {list[0]}
        </p>,
      );
      return;
    }
    blocks.push(
      <ul
        key={`ul-${blocks.length}`}
        className="flex list-disc flex-col gap-0.5 pl-4 marker:text-ink-400"
      >
        {list.map((item, i) => (
          <li key={i}>{item}</li>
        ))}
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
    blocks.push(
      /:$/.test(line.trim()) ? (
        <div key={blocks.length} className="mt-1.5 text-[12px] leading-5 text-ink-500 first:mt-0">
          {line.trim().replace(/:$/, "")}
        </div>
      ) : (
        <p key={blocks.length} className="whitespace-pre-wrap">
          {line}
        </p>
      ),
    );
  }
  flush();
  return (
    <div className="flex flex-col gap-0 text-[13.5px] leading-[1.45rem] text-ink-900">{blocks}</div>
  );
}

function Section({
  config,
  note,
  sectionKey,
  title,
  save,
}: {
  config: PsyConfig;
  note: PsyNote;
  sectionKey: string;
  title: string;
  save: Save;
}) {
  // eslint-disable-next-line security/detect-object-injection -- section key from the served config.
  const text = familyDraftDisplayText(note, note.sections[sectionKey] ?? "");
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
    <section
      aria-labelledby={`psy-sec-${sectionKey}`}
      className="flex flex-col gap-0.5 border-t border-surface-border pt-2.5"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-1.5">
          <h3 id={`psy-sec-${sectionKey}`} className={SEC_H}>
            {title}
          </h3>
          {edited && <Tag tone="brand">Edited</Tag>}
          {!edited && source === "ai" && <Tag>Reworded</Tag>}
          {amendments.length > 0 && <Tag tone="warn">Amended</Tag>}
        </div>
        {canEdit && !editing && (
          <div className="flex gap-2.5">
            {edited && (
              <button
                type="button"
                className={LINK}
                onClick={() => void save({ revert_section: sectionKey })}
              >
                Revert
              </button>
            )}
            <button
              type="button"
              className={LINK}
              onClick={() => {
                setDraft(text);
                setEditing(true);
              }}
            >
              Edit
            </button>
          </div>
        )}
      </div>
      {editing ? (
        <div className="mt-1.5 flex flex-col gap-1.5">
          <AutoResizeTextarea
            className="min-h-[110px] text-[13px] leading-normal"
            aria-label={`Edit ${title}`}
            rows={Math.min(14, Math.max(4, draft.split("\n").length + 1))}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
          />
          <div className="flex gap-1.5">
            <button type="button" className={`${BTN} ${BTN_SM}`} onClick={() => void submit()}>
              Save
            </button>
            <button
              type="button"
              className={`${BTN_GHOST} ${BTN_SM}`}
              onClick={() => setEditing(false)}
            >
              Cancel
            </button>
          </div>
        </div>
      ) : text ? (
        <NoteText text={text} />
      ) : (
        <p className="text-ink-400">
          {note.generated_at ? "Not documented this session." : "Not organised yet."}
        </p>
      )}
      {flags.map((f, i) => (
        <p key={i} className="text-[12px] text-priority-orange">
          Language suggestion: “{f.term}” — {f.suggestion}
        </p>
      ))}
      {amendments.map((a) => (
        <p key={a.id} className="border-l-2 border-brand-green pl-2.5 text-[11.5px] text-ink-500">
          Amended {formatDateTime(a.at)} by {a.by} — {a.reason}
        </p>
      ))}
    </section>
  );
}

function Transcript({
  config,
  note,
  onEditAnswer,
}: {
  config: PsyConfig;
  note: PsyNote;
  onEditAnswer?: (key: string) => void;
}) {
  const languages = new Map(config.languages.map((l) => [l.code, l.label]));
  const editable = note.status !== "SIGNED" && note.is_author && !!onEditAnswer;
  // Only what has been answered: the panel fills in as the session progresses.
  const answered = note.transcript
    .map((row, index) => ({ row, index }))
    .filter(({ row }) => row.text.trim() !== "");
  if (answered.length === 0) {
    return (
      <p className="text-[13.5px] text-ink-500">
        Each answer appears here as you give it. Nothing has been captured yet.
      </p>
    );
  }
  return (
    <ol className="flex flex-col gap-4">
      {answered.map(({ row: t, index: i }) => (
        <li key={t.question}>
          <div className="text-[12.5px] font-semibold text-ink-900">
            Q{i + 1}. {t.title}
          </div>
          <div className="flex flex-wrap items-center gap-x-1.5 text-[11px] text-ink-500">
            <span>
              {modeLabel(t.mode)}
              {t.answered_at ? ` · ${hhmm(t.answered_at)}` : ""} ·{" "}
              {languages.get(t.language) ?? t.language}
            </span>
            {editable && t.text && (
              <button
                type="button"
                className="font-semibold underline underline-offset-2 hover:text-ink-900"
                onClick={() => onEditAnswer?.(t.question)}
              >
                Edit answer
              </button>
            )}
          </div>
          <p className="mt-1 whitespace-pre-wrap text-[13px]">{t.text}</p>
          {t.translation && (
            <div className="mt-1.5 rounded-md border border-surface-border bg-surface-bg px-2.5 py-1.5">
              <div className={FIELD_LABEL}>English translation</div>
              {t.translation.status === "done" && (
                <>
                  <p className="whitespace-pre-wrap text-[13px]">{t.translation.text}</p>
                  <p className="text-[11px] text-ink-500">
                    Machine translation · {t.translation.model} · {formatDateTime(t.translation.at)}{" "}
                    — the clinician’s original words above are the record.
                  </p>
                </>
              )}
              {t.translation.status === "pending" && (
                <p className="animate-pulse text-[12.5px] text-ink-500">Translating…</p>
              )}
              {(t.translation.status === "unavailable" || t.translation.status === "error") && (
                <p className="text-[12.5px] text-ink-500">
                  {config.processed_labels.not_translated}.
                </p>
              )}
            </div>
          )}
        </li>
      ))}
    </ol>
  );
}

function SignFooter({
  config,
  note,
  save,
  sign,
  busy,
}: {
  config: PsyConfig;
  note: PsyNote;
  save: Save;
  sign: () => Promise<boolean>;
  busy: boolean;
}) {
  const [open, setOpen] = useState(true);
  const list = note.checklist;
  const ready = note.blockers.length === 0;
  const na = note.safety_answer === "NOT_ASSESSED";
  return (
    <div className="flex max-h-[45%] flex-shrink-0 flex-col gap-2.5 overflow-y-auto border-t border-surface-border px-[18px] pb-3.5 pt-3 text-[13.5px]">
      {list && (
        <div>
          <button
            type="button"
            aria-expanded={open}
            aria-controls="psy-checklist"
            onClick={() => setOpen((o) => !o)}
            className="flex w-full items-center justify-between gap-2 text-left text-[13px] text-ink-500"
          >
            <span>
              {note.session.session_type === "FAMILY" ? "Before submitting" : "Before signing"}
            </span>
            <span className="inline-flex items-center gap-1">
              {list.done} of {list.total} complete
              <ChevronDown
                className={`h-3.5 w-3.5 transition-transform ${open ? "rotate-180" : ""}`}
              />
            </span>
          </button>
          {open && (
            <ul id="psy-checklist" className="mt-2 flex flex-col gap-[5px]">
              {list.items.map((item) => (
                <li key={item.key} className="grid grid-cols-[18px_1fr] gap-1.5 text-[13px]">
                  <span aria-hidden className={item.done ? "text-brand-green" : "text-ink-500"}>
                    {item.done ? "✓" : "○"}
                  </span>
                  <span>
                    <span className="sr-only">{item.done ? "Done: " : "Not done: "}</span>
                    {item.label}
                    {item.detail && item.key !== "attestation" ? ` (${item.detail})` : ""}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
      {na && !note.safety_ack && (
        <label className="flex items-start gap-2 text-[12.5px]">
          <input
            type="checkbox"
            className="mt-0.5"
            checked={false}
            disabled={!note.not_assessed_reason || !note.is_author}
            onChange={(e) =>
              e.target.checked && void save({ acknowledge_not_assessed: { acknowledged: true } })
            }
          />
          <span>
            {config.not_assessed_ack_text}
            {!note.not_assessed_reason && (
              <span className="block text-[11px] text-ink-500">
                Give the reason in the conversation first.
              </span>
            )}
          </span>
        </label>
      )}
      {na && note.safety_ack && (
        <p className="text-[12px] text-ink-500">
          Acknowledged by {note.safety_ack.by}: {note.safety_ack.reason}
        </p>
      )}
      <label className="flex items-start gap-2 text-[12.5px]">
        <input
          type="checkbox"
          className="mt-0.5"
          checked={note.accuracy_confirmed}
          disabled={!note.generated_at || !note.is_author || note.processing.status === "pending"}
          onChange={(e) => void save({ accuracy_confirmed: e.target.checked })}
        />
        <span>{config.attestation_text}</span>
      </label>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          disabled={!ready || busy || !note.is_author}
          onClick={() => void sign()}
          title={ready ? undefined : note.blockers.map((b) => b.text).join("\n")}
          className="flex-1 rounded-[11px] bg-brand-green p-2.5 text-[13.5px] font-semibold text-on-primary disabled:cursor-not-allowed disabled:bg-surface-bg disabled:text-ink-500"
        >
          {note.session.session_type === "FAMILY" ? "Submit report" : "Sign note"}
        </button>
        <button
          type="button"
          className="rounded-[10px] border border-surface-border bg-surface-card px-3.5 py-2 text-[13.5px] font-medium hover:border-brand-green"
          onClick={() => void copyText(familyDraftDisplayText(note, note.rendered))}
        >
          Copy
        </button>
      </div>
      {!ready && <p className="text-[11px] text-ink-500">{note.blockers[0]?.text}</p>}
    </div>
  );
}

function SignedFooter({
  config,
  note,
  amend,
  onSelfAssessment,
}: {
  config: PsyConfig;
  note: PsyNote;
  amend: (b: { section: string; text: string; reason: string }) => Promise<boolean>;
  onSelfAssessment?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const sections = noteSections(config, note.session.session_type);
  const selfAssessment = note.session.therapist_self_assessment;
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
      <p className="text-[12px] text-ink-500">
        {note.session.session_type === "FAMILY"
          ? `Report submitted by ${note.author} · ${formatDateTime(note.signed_at)}. The submitted report is locked — changes are dated, named amendments.`
          : `Signed by ${note.author} · ${formatDateTime(note.signed_at)}. A signed note is locked — changes are dated, named amendments.`}
      </p>
      {open && (
        <div className="flex flex-col gap-1.5">
          <select
            className={INPUT}
            aria-label="Section to amend"
            value={section}

            onChange={(e) => {
              setSection(e.target.value);
              setText(note.sections[e.target.value] ?? "");
            }}
          >
            {sections.map((s) => (
              <option key={s.key} value={s.key}>
                {s.title}
              </option>
            ))}
          </select>
          <AutoResizeTextarea
            rows={4}
            aria-label="Amended text"
            value={text}
            onChange={(e) => setText(e.target.value)}
          />
          <input
            className={INPUT}
            aria-label="Reason for the amendment"
            placeholder="Reason for the amendment (required)"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
          <div className="flex gap-2">
            <button
              type="button"
              className={`${BTN} ${BTN_SM}`}
              disabled={reason.trim().length < 3}
              onClick={() => void submit()}
            >
              Save amendment
            </button>
            <button
              type="button"
              className={`${BTN_GHOST} ${BTN_SM}`}
              onClick={() => setOpen(false)}
            >
              Cancel
            </button>
          </div>
        </div>
      )}
      <div className="flex flex-wrap gap-2">
        {note.is_author && onSelfAssessment && (
          <button type="button" className={`${BTN} ${BTN_SM}`} onClick={onSelfAssessment}>
            <ClipboardCheck className="h-3.5 w-3.5" />
            {selfAssessment ? "View self-assessment" : "Do self-assessment"}
            <span className="font-normal opacity-80">
              {selfAssessment ? "· completed" : "· not started"}
            </span>
          </button>
        )}
        {!open && (
          <button type="button" className={`${BTN_GHOST} ${BTN_SM}`} onClick={() => setOpen(true)}>
            Add amendment
          </button>
        )}
        <button
          type="button"
          className={`${BTN_GHOST} ${BTN_SM}`}
          onClick={() => void copyText(note.rendered)}
        >
          <Copy className="h-3.5 w-3.5" /> Copy
        </button>
      </div>
    </div>
  );
}

// `appointment-type` codes this card books; group psychotherapy is booked through the
// group programme. The server enforces the same list.
const PSYCHOTHERAPY_APPOINTMENT_TYPES = ["Individual psychotherapy", "Family psychotherapy"];

export function PsychotherapyPlanCard({
  patientId,
  fixedAppointmentType,
}: {
  patientId: string;
  fixedAppointmentType?: string;
}) {
  const { accessToken } = useAuth();
  const vs = useValueSets();
  const [schedule, setSchedule] = useState<PsychotherapyPlanSchedule | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [scheduledFor, setScheduledFor] = useState("");
  const [mode, setMode] = useState<"IN_PERSON" | "PHONE" | "VIDEO">("IN_PERSON");
  const [appointmentType, setAppointmentType] = useState(
    fixedAppointmentType ?? PSYCHOTHERAPY_APPOINTMENT_TYPES[0],
  );
  const [duration, setDuration] = useState(30);
  const [sessionNote, setSessionNote] = useState("");
  const [scheduling, setScheduling] = useState(false);
  const [booking, setBooking] = useState(false);
  const [scheduleMessage, setScheduleMessage] = useState<string | null>(null);
  // One stable id per booking: a retry of the same booking reuses it, and a new one is
  // issued once a booking succeeds so the next session is not taken for a retry.
  const [requestId, setRequestId] = useState(() => crypto.randomUUID());
  const typeOptions = vs
    .options("appointment-type")
    .filter(
      (o) =>
        PSYCHOTHERAPY_APPOINTMENT_TYPES.includes(o.code) &&
        (!fixedAppointmentType || o.code === fixedAppointmentType),
    );

  const load = () => {
    if (!accessToken || !patientId) return;
    getPsychotherapyPlanSchedule(accessToken, patientId)
      .then(setSchedule)
      .catch((e) => setError(e instanceof Error ? e.message : "Couldn't load sessions."));
  };

  useEffect(() => {
    load();
  }, [accessToken, patientId]);

  const psychActivity =
    schedule?.plan?.activities.find(
      (a) =>
        a.available_to_psychotherapy &&
        a.status === "PLANNED" &&
        !(schedule?.scheduled_sessions ?? []).some((s) => s.care_plan_activity_id === a.id),
    ) ?? null;
  const scheduledSessions =
    schedule?.scheduled_sessions.filter(
      (session) => !fixedAppointmentType || session.appointment_type === fixedAppointmentType,
    ) ?? [];

  const scheduleSession = async () => {
    if (!accessToken || !scheduledFor) return;
    setScheduling(true);
    setError(null);
    setScheduleMessage(null);
    try {
      const updated = await schedulePsychotherapySession(accessToken, patientId, {
        care_plan_activity: psychActivity?.id ?? "",
        scheduled_for: new Date(scheduledFor).toISOString(),
        duration_minutes: duration,
        mode,
        notes: sessionNote.trim(),
        client_request_id: requestId,
        appointment_type: appointmentType,
      });
      setSchedule(updated);
      setRequestId(crypto.randomUUID());
      setScheduledFor("");
      setSessionNote("");
      setBooking(false);
      setScheduleMessage(
        fixedAppointmentType
          ? "Family psychotherapy session scheduled."
          : "Next psychotherapy session scheduled.",
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't schedule session.");
    } finally {
      setScheduling(false);
    }
  };

  const label = "text-[11px] font-medium text-ink-500";
  return (
    <section className="mt-4 rounded-xl border border-surface-border bg-surface-card">
      <header className="flex items-center justify-between gap-3 border-b border-surface-border px-4 py-3">
        <h3 className="text-sm font-semibold text-ink-900">
          {fixedAppointmentType ? "Next family sessions" : "Next sessions"}
          {scheduledSessions.length > 0 && (
            <span className="ml-2 rounded-full bg-surface-bg px-2 py-0.5 text-[11px] font-semibold text-ink-500">
              {scheduledSessions.length}
            </span>
          )}
        </h3>
        {!booking && (
          <button
            type="button"
            className={`${BTN_GHOST} ${BTN_SM}`}
            onClick={() => {
              setBooking(true);
              setScheduleMessage(null);
            }}
          >
            Book a session
          </button>
        )}
      </header>

      {scheduledSessions.length > 0 ? (
        <ul className="divide-y divide-surface-border">
          {scheduledSessions.map((s) => (
            <li key={s.id} className="flex flex-wrap items-baseline gap-x-3 px-4 py-2.5 text-xs">
              <span className="font-semibold tabular-nums text-ink-900">
                {formatDateTime(s.scheduled_for)}
              </span>
              <span className="text-ink-500">
                {s.duration_minutes} min · {s.mode.replace("_", " ").toLowerCase()}
                {s.provider_name ? ` · ${s.provider_name}` : ""}
              </span>
              {s.notes && <span className="w-full truncate text-ink-500">{s.notes}</span>}
            </li>
          ))}
        </ul>
      ) : (
        <p className="px-4 py-3 text-xs text-ink-500">No upcoming sessions booked.</p>
      )}

      {schedule?.plan && (
        <details className="border-t border-surface-border px-4 py-2.5 text-xs">
          <summary className="cursor-pointer font-medium text-ink-700">Care plan goals</summary>
          <p className="mt-1.5 whitespace-pre-wrap text-ink-700">
            {schedule.plan.goals || "No plan goals recorded."}
          </p>
        </details>
      )}

      {booking && (
        <div className="border-t border-surface-border px-4 py-3">
          <div className="grid gap-2.5 sm:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)_90px]">
            {!fixedAppointmentType && typeOptions.length > 1 && (
              <label className={`${label} sm:col-span-3`}>
                Type
                <select
                  className={`${INPUT} mt-1`}
                  value={appointmentType}
                  onChange={(e) => setAppointmentType(e.target.value)}
                >
                  {typeOptions.map((o) => (
                    <option key={o.code} value={o.code}>
                      {o.display}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <label className={label}>
              Date and time
              <input
                className={`${INPUT} mt-1`}
                type="datetime-local"
                value={scheduledFor}
                onChange={(e) => setScheduledFor(e.target.value)}
              />
            </label>
            <label className={label}>
              Format
              <select
                className={`${INPUT} mt-1`}
                value={mode}
                onChange={(e) => setMode(e.target.value as "IN_PERSON" | "PHONE" | "VIDEO")}
              >
                <option value="IN_PERSON">In person</option>
                <option value="PHONE">Phone</option>
                <option value="VIDEO">Video</option>
              </select>
            </label>
            <label className={label}>
              Minutes
              <input
                className={`${INPUT} mt-1`}
                type="number"
                min={5}
                max={240}
                value={duration}
                onChange={(e) => setDuration(Number(e.target.value) || 30)}
              />
            </label>
            <label className={`${label} sm:col-span-3`}>
              Note (optional)
              <input
                className={`${INPUT} mt-1`}
                type="text"
                maxLength={500}
                placeholder="Logistics only"
                value={sessionNote}
                onChange={(e) => setSessionNote(e.target.value)}
              />
            </label>
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <button
              type="button"
              disabled={scheduling || !scheduledFor || !typeOptions.length}
              onClick={() => void scheduleSession()}
              className={`${BTN} ${BTN_SM}`}
            >
              {scheduling ? "Booking…" : "Book session"}
            </button>
            <button
              type="button"
              className={`${BTN_GHOST} ${BTN_SM}`}
              disabled={scheduling}
              onClick={() => setBooking(false)}
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {(scheduleMessage || error || vs.error) && (
        <p
          role={error || vs.error ? "alert" : "status"}
          className={`border-t border-surface-border px-4 py-2.5 text-xs ${
            error || vs.error ? "text-priority-red" : "font-medium text-brand-green"
          }`}
        >
          {error || vs.error || scheduleMessage}
        </p>
      )}
    </section>
  );
}
