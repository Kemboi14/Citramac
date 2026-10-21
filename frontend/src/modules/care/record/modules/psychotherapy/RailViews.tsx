import { ArrowLeft, X } from "lucide-react";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useAuth } from "../../../../../auth/useAuth";
import { useDialogA11y } from "../../../../../components/useDialogA11y";
import {
  addTherapyModel,
  getPsyNote,
  listTherapyModels,
  updateTherapyModel,
  type HistoryEntry,
  type PsyConfig,
  type PsyNote,
  type PsyNoteSummary,
  type TherapyModelRow,
} from "../../../../../lib/psychotherapyNoteApi";
import { formatDate, formatDateTime } from "../../../shared/format";
import { BTN, BTN_GHOST, BTN_SM, FIELD_LABEL, INPUT } from "../../../shared/styles";
import { ErrorNote, Tag } from "../../../shared/ui";
import { errorText } from "../../../triage/helpers";
import { ddmmyyyy, hhmm } from "./helpers";

// Rail views of the psychotherapy workspace: session history (and a read-only
// signed note), the client file, the audit trail and the therapy-approach
// registry. Everything shown comes from the server; nothing is cached locally.

function Page({ children }: { children: ReactNode }) {
  return <div className="mx-auto flex w-full max-w-[760px] flex-col gap-4 px-4 py-5 sm:px-6">{children}</div>;
}

function Back({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="inline-flex w-fit items-center gap-1.5 text-[12.5px] font-semibold text-brand-green hover:underline">
      <ArrowLeft className="h-4 w-4" /> {label}
    </button>
  );
}

function Heading({ label, title, sub }: { label: string; title: string; sub?: string }) {
  return (
    <div>
      <div className={FIELD_LABEL}>{label}</div>
      <h1 className="font-display text-xl font-semibold text-ink-900">{title}</h1>
      {sub && <div className="text-[12.5px] text-ink-500">{sub}</div>}
    </div>
  );
}

function Block({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="rounded-lg border border-surface-border bg-surface-card p-3.5">
      <h3 className="mb-2 text-[13px] font-bold text-ink-900">{title}</h3>
      {children}
    </section>
  );
}

/** Chat · session history: the current draft and the client's earlier notes. */
export function SessionHistory({ note, notes, onBack, onOpenCurrent, onOpenPast, onNew }: {
  note: PsyNote;
  notes: PsyNoteSummary[] | null;
  onBack: () => void;
  onOpenCurrent: () => void;
  onOpenPast: (id: string) => void;
  onNew: () => void;
}) {
  const earlier = (notes ?? []).filter((n) => n.id !== note.id);
  const answered = Object.values(note.answers).filter((a) => a?.text?.trim()).length;
  return (
    <Page>
      <Back label="Back to session" onClick={onBack} />
      <Heading label="Chat" title="Session history" sub={`${note.patient.name} · ${note.patient.number || "—"} · ${(notes ?? []).length || 1} sessions`} />
      <Block title="Current">
        <button type="button" onClick={onOpenCurrent} aria-current="page"
          className="flex w-full flex-wrap items-center gap-2 rounded-md border border-brand-green bg-brand-green-tint px-3 py-2 text-left">
          <strong className="text-[13px]">Session {note.session_number ?? ""} · current</strong>
          <Tag tone={note.status === "SIGNED" ? "brand" : "warn"}>{note.status === "SIGNED" ? "Signed" : "Draft"}</Tag>
          <span className="w-full text-[12px] text-ink-500">
            {ddmmyyyy(note.session.session_date)} · {answered} of 5 questions answered{note.signed_at ? ` · signed ${formatDateTime(note.signed_at)}` : ""}
          </span>
        </button>
      </Block>
      <Block title="Earlier · psychotherapy notes">
        {!notes && <p className="text-[13px] text-ink-500">Loading…</p>}
        {notes && earlier.length === 0 && <p className="text-[13px] text-ink-500">No earlier psychotherapy notes for this client.</p>}
        <div className="flex flex-col gap-1.5">
          {earlier.map((n) => (
            <button key={n.id} type="button" disabled={n.restricted || n.status !== "SIGNED"} onClick={() => onOpenPast(n.id)}
              className="flex w-full flex-wrap items-center gap-2 rounded-md border border-surface-border px-3 py-2 text-left hover:bg-surface-bg disabled:cursor-default disabled:hover:bg-transparent">
              <strong className="text-[13px]">{formatDate(n.session_date)}</strong>
              <Tag tone={n.status === "SIGNED" ? "brand" : "warn"}>{n.status === "SIGNED" ? "Signed" : "Draft"}</Tag>
              <span className="w-full text-[12px] text-ink-500">
                {n.author}{n.restricted ? " · visible to the care team only" : n.status !== "SIGNED" ? " · another clinician's draft" : ""}
              </span>
            </button>
          ))}
        </div>
      </Block>
      <div><button type="button" className={BTN} onClick={onNew}>New session</button></div>
    </Page>
  );
}

/** A signed note, read-only (amendments shown under their section). */
export function PastNote({ config, id, onBack }: { config: PsyConfig; id: string; onBack: () => void }) {
  const { accessToken } = useAuth();
  const [past, setPast] = useState<PsyNote | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!accessToken) return;
    getPsyNote(accessToken, id).then(setPast).catch((e) => setError(errorText(e, "Couldn't open that note.")));
  }, [accessToken, id]);
  return (
    <Page>
      <Back label="Session history" onClick={onBack} />
      <ErrorNote>{error}</ErrorNote>
      {!past && !error && <p className="text-[13px] text-ink-500">Loading…</p>}
      {past && (
        <>
          <Heading label="Read-only · signed record" title={`Session ${past.session_number ?? ""}`}
            sub={`${ddmmyyyy(past.session.session_date)} · ${past.author} · ${past.models_applied.map((m) => m.name).join("; ") || "Approach not specified"}`} />
          <div className="flex flex-col gap-3 rounded-lg border border-surface-border bg-surface-card p-4">
            {config.sections.filter((s) => s.key !== "session_information").map((s) => (
              <section key={s.key}>
                <h3 className={FIELD_LABEL}>{s.title}</h3>
                { }
                <p className="mt-1 whitespace-pre-wrap text-[13px]">{past.sections[s.key] || "—"}</p>
                {past.amendments.filter((a) => a.section === s.key).map((a) => (
                  <p key={a.id} className="mt-1 text-[11.5px] text-ink-500">Amended {formatDateTime(a.at)} by {a.by} — {a.reason}</p>
                ))}
              </section>
            ))}
            <div className="border-t border-surface-border pt-2 text-[12px] text-ink-500">Electronically signed by {past.author} · {formatDateTime(past.signed_at)}</div>
          </div>
        </>
      )}
    </Page>
  );
}

/** Client file: overview, risk & safety, treatment-plan goals, session history. */
export function ClientFile({ note, notes, onBack }: { note: PsyNote; notes: PsyNoteSummary[] | null; onBack: () => void }) {
  const c = note.context;
  const signed = (notes ?? []).filter((n) => n.status === "SIGNED");
  return (
    <Page>
      <Back label="Back to session" onClick={onBack} />
      <Heading label="Client record" title={note.patient.name} sub={`Record ${note.patient.number || "—"}`} />
      <Block title="Overview">
        <dl className="grid grid-cols-1 gap-x-4 gap-y-1.5 text-[13px] sm:grid-cols-[180px_1fr]">
          <dt className="text-ink-500">Diagnosis on file</dt><dd>{c.diagnoses.join("; ") || "Not recorded"}</dd>
          <dt className="text-ink-500">Treating clinician</dt><dd>{note.author}</dd>
          <dt className="text-ink-500">Session</dt><dd>{note.session_number ? `Session ${note.session_number}` : "—"} · {ddmmyyyy(note.session.session_date)}</dd>
        </dl>
      </Block>
      <Block title="Risk & safety">
        <dl className="grid grid-cols-1 gap-x-4 gap-y-1.5 text-[13px] sm:grid-cols-[180px_1fr]">
          <dt className="text-ink-500">Active safety plan</dt>
          <dd>{c.safety_plan ? `${c.safety_plan.display_id} · version ${c.safety_plan.version} · signed ${c.safety_plan.signed_at}` : "No signed safety plan on record"}</dd>
          <dt className="text-ink-500">Current risk items</dt>
          <dd>{c.risk.length ? <ul className="ml-4 list-disc">{c.risk.map((r) => <li key={r.key}>{r.text} <span className="text-ink-500">({r.source})</span></li>)}</ul> : "No active risk items on the record"}</dd>
        </dl>
      </Block>
      <Block title="Treatment-plan goals">
        {c.goals.length ? (
          <ul className="flex flex-col gap-1.5">
            {c.goals.map((g) => (
              <li key={g.index} className="flex items-start gap-2 text-[13px]">
                <span className="font-mono text-brand-green">G{g.index + 1}</span>
                <span className="flex-1">{g.goal}{g.review_date && <span className="block text-[11.5px] text-ink-500">Review {g.review_date}</span>}</span>
                <Tag tone="brand">Active</Tag>
              </li>
            ))}
          </ul>
        ) : <p className="text-[13px] text-ink-500">No goals on the current care plan.</p>}
      </Block>
      <Block title="Session history">
        {!notes && <p className="text-[13px] text-ink-500">Loading…</p>}
        {notes && signed.length === 0 && <p className="text-[13px] text-ink-500">No signed psychotherapy notes yet.</p>}
        <ul className="flex flex-col gap-1">
          {signed.map((n) => (
            <li key={n.id} className="flex gap-3 text-[13px]">
              <span className="font-mono text-[12px] text-ink-500">{formatDate(n.session_date)}</span>
              <span>{n.author}{n.restricted ? " · visible to the care team only" : n.amendments ? ` · ${n.amendments} amendment${n.amendments === 1 ? "" : "s"}` : ""}</span>
            </li>
          ))}
        </ul>
        {c.previous_note && !c.previous_note.restricted && (c.previous_note.plan || c.previous_note.text) && (
          <div className="mt-2 rounded-md bg-surface-bg p-2 text-[12.5px]">
            <div className={FIELD_LABEL}>Previous note · plan</div>
            <p className="whitespace-pre-wrap">{c.previous_note.plan ?? c.previous_note.text}</p>
          </div>
        )}
      </Block>
    </Page>
  );
}

type EventType = "session" | "answer" | "safety" | "edit" | "sign" | "clinical";
const TYPE_LABEL: Record<EventType, string> = {
  session: "Session", answer: "Answer", safety: "Safety", edit: "Edit", sign: "Sign-off", clinical: "Clinical",
};
const TYPE_DOT: Record<EventType, string> = {
  session: "border-ink-400", answer: "border-brand-green", safety: "border-priority-red", edit: "border-priority-orange",
  sign: "border-brand-green-dark bg-brand-green", clinical: "border-ink-700",
};

function eventType(e: HistoryEntry): EventType {
  const a = e.action;
  if (a === "SIGN" || a === "ATTEST" || a.startsWith("AMEND")) return "sign";
  if (a === "ANSWER" || a.startsWith("TRANSLATE")) return "answer";
  if (["EDIT_SECTIONS", "REVERT_SECTION", "SESSION_INFO"].includes(a)) return "edit";
  if (a.startsWith("GOAL_LINK") || a.startsWith("MODEL_")) return "clinical";
  const field = typeof e.field === "string" ? e.field : "";
  if (["RISK_LINK", "REVIEW_DETECTION", "ACKNOWLEDGE", "RAISE_ALERT", "RESOLVE_ALERT"].includes(a) ||
    field.startsWith("safety") || field === "not_assessed_reason") return "safety";
  return "session";
}

const ACTION_TEXT: Record<string, string> = {
  CREATE: "Session note started", ANSWER: "Answer recorded", TRANSLATE: "Answer translated into English",
  TRANSLATE_FAILED: "Translation did not complete — original words used", GENERATE: "Note organised",
  REWORD: "Note sections reworded in trauma-informed language", REWORD_FAILED: "Rewording did not complete — rule-based text kept",
  EDIT_SECTIONS: "Note section edited", REVERT_SECTION: "Note section reverted to the generated text",
  SESSION_INFO: "Session information updated", RISK_LINK: "Risk assessment linked", REVIEW_DETECTION: "Flagged language marked reviewed",
  ACKNOWLEDGE: "Safety not assessed — reason acknowledged", RAISE_ALERT: "Alert raised on the client record",
  RESOLVE_ALERT: "Alert resolved", ATTEST: "Clinician attestation ticked", SIGN: "Note signed",
};

function describe(e: HistoryEntry) {
  if (e.action.startsWith("GOAL_LINK_")) return `Goal decision: ${e.action.slice(10).replace("_", " ").toLowerCase()}${typeof e.goal === "string" ? ` — ${e.goal}` : ""}`;
  if (e.action.startsWith("MODEL_")) return `Therapy approach ${e.action === "MODEL_INCLUDE" ? "included" : "excluded"}${typeof e.model === "string" ? ` — ${e.model}` : ""}`;
  if (e.action === "UPDATE" && typeof e.field === "string") return `Updated ${e.field.replace(/_/g, " ")}`;
  const base = ACTION_TEXT[e.action] ?? e.action.replace(/_/g, " ").toLowerCase();
  return typeof e.question === "string" ? `${base} (${e.question.toUpperCase()})` : base;
}

/** Audit trail: note.history, newest first, with typed dots. */
export function AuditTrail({ note, onBack }: { note: PsyNote; onBack: () => void }) {
  const list = [...note.history].reverse();
  return (
    <Page>
      <Back label="Back to session" onClick={onBack} />
      <Heading label="Audit trail" title={`Session ${note.session_number ?? ""} timeline`} sub={`${list.length} events · ${ddmmyyyy(note.session.session_date)} · newest first`} />
      <div className="flex flex-wrap gap-1.5">
        {(Object.keys(TYPE_LABEL) as EventType[]).map((k) => (
          // eslint-disable-next-line security/detect-object-injection -- fixed key union.
          <span key={k} className="inline-flex items-center gap-1.5 rounded-full border border-surface-border px-2 py-0.5 text-[11.5px]"><span aria-hidden className={`h-2.5 w-2.5 rounded-full border-2 ${TYPE_DOT[k]}`} />{TYPE_LABEL[k]}</span>
        ))}
      </div>
      {list.length === 0 ? <p className="text-[13px] text-ink-500">No activity yet.</p> : (
        <ol className="flex flex-col">
          {list.map((e, i) => {
            const type = eventType(e);
            return (
              <li key={i} className="flex gap-3 border-l border-surface-border pb-3 pl-3">
                {/* eslint-disable-next-line security/detect-object-injection -- fixed key union. */}
                <span aria-hidden className={`-ml-[19px] mt-1 h-3 w-3 flex-shrink-0 rounded-full border-2 bg-surface-card ${TYPE_DOT[type]}`} />
                <span className="w-24 flex-shrink-0 font-mono text-[11.5px] text-ink-500">{ddmmyyyy(e.at)} {hhmm(e.at)}</span>
                <span className="min-w-0 flex-1 text-[13px]">
                  {/* eslint-disable-next-line security/detect-object-injection -- fixed key union. */}
                  <span className="mr-1.5 text-[11px] font-semibold uppercase tracking-wide text-ink-500">{TYPE_LABEL[type]}</span>
                  {describe(e)} <span className="text-ink-500">· {e.by}</span>
                </span>
              </li>
            );
          })}
        </ol>
      )}
    </Page>
  );
}

const split = (v: string) => v.split(",").map((x) => x.trim()).filter(Boolean);

/** Therapy approaches: the organisation's model registry. Adding or removing
 * is offered only to users the server lets configure it. */
export function ApproachesDialog({ onClose, onChanged }: { onClose: () => void; onChanged: () => void }) {
  const { accessToken } = useAuth();
  const ref = useDialogA11y<HTMLDivElement>(true, onClose);
  const [rows, setRows] = useState<TherapyModelRow[] | null>(null);
  const [canConfigure, setCanConfigure] = useState(false);
  const [form, setForm] = useState({ name: "", aliases: "", concepts: "" });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const load = useCallback(async () => {
    if (!accessToken) return;
    try {
      const res = await listTherapyModels(accessToken);
      setRows(res.results);
      setCanConfigure(res.can_configure);
    } catch (e) {
      setError(errorText(e, "Couldn't load the therapy approaches."));
    }
  }, [accessToken]);
  useEffect(() => {
    let cancelled = false;
    if (accessToken) {
      listTherapyModels(accessToken)
        .then((res) => {
          if (cancelled) return;
          setRows(res.results);
          setCanConfigure(res.can_configure);
        })
        .catch((e) => !cancelled && setError(errorText(e, "Couldn't load the therapy approaches.")));
    }
    return () => {
      cancelled = true;
    };
  }, [accessToken]);
  async function run(work: (t: string) => Promise<unknown>) {
    if (!accessToken) return false;
    setBusy(true);
    setError(null);
    try {
      await work(accessToken);
      await load();
      onChanged();
      return true;
    } catch (e) {
      setError(errorText(e, "Couldn't save the change.", { name: "Approach name", concepts: "Concepts" }));
      return false;
    } finally {
      setBusy(false);
    }
  }
  async function add() {
    const aliases = split(form.aliases);
    const ok = await run((t) => addTherapyModel(t, { name: form.name.trim(), aliases: aliases.length ? aliases : [form.name.trim()], concepts: split(form.concepts) }));
    if (ok) setForm({ name: "", aliases: "", concepts: "" });
  }
  const enabled = (rows ?? []).filter((m) => m.enabled);
  const removed = (rows ?? []).filter((m) => !m.enabled && m.custom);
  return createPortal(
    <>
      <div className="fixed inset-0 z-[110] bg-surface-scrim" onClick={onClose} />
      <div className="fixed inset-0 z-[120] flex items-center justify-center p-3 sm:p-6">
        <div ref={ref} role="dialog" aria-modal="true" aria-labelledby="psy-lib-title"
          className="flex max-h-[92vh] w-full max-w-[640px] flex-col overflow-hidden rounded-[14px] bg-surface-card shadow-md">
          <div className="flex items-start justify-between gap-3 border-b border-surface-border px-5 py-4">
            <div>
              <div className={FIELD_LABEL}>Therapy-model knowledge layer</div>
              <h2 id="psy-lib-title" className="font-display text-lg font-bold text-ink-900">Therapy approaches</h2>
              <p className="mt-0.5 text-[12.5px] text-ink-500">The five questions never change. This list only shapes note language when you name or clearly describe an approach.</p>
            </div>
            <button type="button" aria-label="Close" onClick={onClose}
              className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-[9px] border border-surface-border text-ink-700 hover:bg-surface-bg">
              <X className="h-4 w-4" />
            </button>
          </div>
          <div className="flex flex-col gap-3 overflow-y-auto px-5 py-4">
            <ErrorNote>{error}</ErrorNote>
            {canConfigure ? (
              <fieldset className="grid grid-cols-1 gap-2 rounded-lg border border-surface-border p-3 sm:grid-cols-2">
                <legend className={`${FIELD_LABEL} px-1`}>Add an approach</legend>
                <label className="flex flex-col gap-1"><span className={FIELD_LABEL}>Approach name</span>
                  <input className={INPUT} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></label>
                <label className="flex flex-col gap-1"><span className={FIELD_LABEL}>Names clinicians use</span>
                  <input className={INPUT} placeholder="Comma separated" value={form.aliases} onChange={(e) => setForm({ ...form, aliases: e.target.value })} /></label>
                <label className="flex flex-col gap-1 sm:col-span-2"><span className={FIELD_LABEL}>Concepts to recognise (comma separated)</span>
                  <input className={INPUT} value={form.concepts} onChange={(e) => setForm({ ...form, concepts: e.target.value })} /></label>
                <div><button type="button" className={`${BTN} ${BTN_SM}`} disabled={busy || !form.name.trim() || !split(form.concepts).length} onClick={() => void add()}>Add approach</button></div>
              </fieldset>
            ) : (
              <p className="text-[12.5px] text-ink-500">Only an organisation administrator can add or remove approaches.</p>
            )}
            {!rows && !error && <p className="text-[13px] text-ink-500">Loading…</p>}
            {enabled.map((m) => (
              <div key={m.code} className="rounded-lg border border-surface-border p-3">
                <div className="flex items-center justify-between gap-2">
                  <strong className="text-[13.5px]">{m.name} <span className="text-[11px] font-normal text-ink-500">v{m.version}</span></strong>
                  {canConfigure && m.custom && (
                    <button type="button" className={`${BTN_GHOST} ${BTN_SM}`} disabled={busy} onClick={() => void run((t) => updateTherapyModel(t, m.code, { enabled: false }))}>Remove</button>
                  )}
                </div>
                <div className="text-[12px] text-ink-500">Recognised as: {m.aliases.join(", ") || m.name}</div>
                <div className="mt-1.5 flex flex-wrap gap-1">{m.concepts.map((c) => <Tag key={c}>{c}</Tag>)}</div>
              </div>
            ))}
            {canConfigure && removed.length > 0 && (
              <div>
                <div className={FIELD_LABEL}>Removed</div>
                {removed.map((m) => (
                  <div key={m.code} className="mt-1 flex items-center justify-between gap-2 text-[13px]">
                    <span>{m.name}</span>
                    <button type="button" className={`${BTN_GHOST} ${BTN_SM}`} disabled={busy} onClick={() => void run((t) => updateTherapyModel(t, m.code, { enabled: true }))}>Restore</button>
                  </div>
                ))}
              </div>
            )}
          </div>
          <div className="flex justify-end border-t border-surface-border px-5 py-3">
            <button type="button" className={BTN_GHOST} onClick={onClose}>Done</button>
          </div>
        </div>
      </div>
    </>,
    document.body,
  );
}
