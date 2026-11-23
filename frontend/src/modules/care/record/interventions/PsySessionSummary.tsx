import { CheckCircle2 } from "lucide-react";
import { useEffect, useState } from "react";
import { useAuth } from "../../../../auth/useAuth";
import {
  getPsyConfig,
  getPsyNote,
  type PsyConfig,
  type PsyNote,
} from "../../../../lib/psychotherapyNoteApi";
import { AnswerList } from "../../shared/AnswerList";
import { formatDateTime } from "../../shared/format";
import { BTN_GHOST, BTN_SM } from "../../shared/styles";
import { Card, ErrorNote, Tag } from "../../shared/ui";
import { errorText } from "../../triage/helpers";
import { noteSections } from "../modules/psychotherapy/helpers";

const SAFETY: Record<string, string> = {
  YES: "Safety concern raised",
  NO: "No safety concern",
  NOT_ASSESSED: "Safety not assessed",
};

const MODE: Record<string, string> = {
  IN_PERSON: "In person",
  PHONE: "Phone",
  VIDEO: "Video",
};

/**
 * A signed psychotherapy session as what was done: who signed it and when, the
 * session's focus and safety answer, then each written section — its amended
 * text where it was amended. Read-only; the full note opens from here.
 */
export function PsySessionSummary({
  noteId,
  sessionNumber,
  onBack,
  onOpenNote,
  initialNote,
  backLabel = "Sessions",
}: {
  /** Already loaded by the caller (one read, one audit entry). */
  initialNote?: PsyNote;
  backLabel?: string;
  noteId: string;
  sessionNumber: number;
  onBack: () => void;
  onOpenNote: () => void;
}) {
  const { accessToken } = useAuth();
  const [note, setNote] = useState<PsyNote | null>(initialNote ?? null);
  const [config, setConfig] = useState<PsyConfig | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!accessToken) return;
    let active = true;
    Promise.all([
      initialNote ? Promise.resolve(initialNote) : getPsyNote(accessToken, noteId),
      getPsyConfig(accessToken),
    ])
      .then(([loaded, cfg]) => {
        if (!active) return;
        setNote(loaded as PsyNote);
        setConfig(cfg as PsyConfig);
      })
      .catch((e) => active && setError(errorText(e, "Couldn't open this session.")));
    return () => {
      active = false;
    };
  }, [accessToken, noteId, initialNote]);

  if (error) return <ErrorNote>{error}</ErrorNote>;
  if (!note || !config) return <p className="text-[13px] text-ink-500">Opening the session…</p>;

  // The text as it stands: the latest amendment of a section replaces it.
  const amended = new Map<string, string>();
  for (const amendment of note.amendments) amended.set(amendment.section, amendment.new_text);
  const sections = noteSections(config, note.session_type)
    .map((section) => ({
      ...section,
      text: (amended.get(section.key) ?? note.sections[section.key] ?? "").trim(),
      wasAmended: amended.has(section.key),
    }))
    .filter((section) => section.text);

  const facts = [
    { label: "Date", value: formatDateTime(note.session.session_date) },
    {
      label: "Duration",
      value: note.session.duration_minutes ? `${note.session.duration_minutes} min` : "",
    },
    {
      label: "Attendance",
      value: MODE[note.session.attendance_mode] ?? note.session.attendance_mode,
    },
    { label: "Session objective", value: note.session.session_objective },
    { label: "Goal", value: note.session.primary_goal },
    { label: "Safety", value: SAFETY[note.safety_answer ?? ""] ?? "" },
    {
      label: "Measure",
      value: note.session.measure
        ? `${note.session.measure.name} ${note.session.measure.total}`
        : "",
    },
  ].filter((row) => row.value);

  return (
    <div className="flex flex-col gap-4">
      <div>
        <button type="button" className={`${BTN_GHOST} ${BTN_SM}`} onClick={onBack}>
          ← {backLabel}
        </button>
      </div>
      <div className="flex flex-wrap items-center gap-3 rounded-xl border border-surface-border bg-surface-card p-4 shadow-sm">
        <CheckCircle2 aria-hidden className="h-6 w-6 shrink-0 text-[var(--green)]" />
        <div className="mr-auto min-w-0">
          <p className="flex flex-wrap items-center gap-2 text-[15px] font-semibold text-ink-900">
            Session {sessionNumber} completed
            {note.amendments.length > 0 && <Tag>Amended</Tag>}
          </p>
          <p className="text-[12.5px] text-ink-500">
            Signed {note.signed_at ? formatDateTime(note.signed_at) : ""}
            {note.author ? ` by ${note.author}` : ""}
          </p>
        </div>
        <button type="button" className={`${BTN_GHOST} ${BTN_SM}`} onClick={onOpenNote}>
          Open full note
        </button>
      </div>
      {facts.length > 0 && (
        <Card title="Session">
          <AnswerList rows={facts} />
        </Card>
      )}
      {sections.map((section) => (
        <Card
          key={section.key}
          title={
            <span className="flex items-center gap-2">
              {section.title}
              {section.wasAmended && <Tag>Amended</Tag>}
            </span>
          }
        >
          <p className="whitespace-pre-wrap text-[13.5px] leading-6 text-ink-900">{section.text}</p>
        </Card>
      ))}
    </div>
  );
}
