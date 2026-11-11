import { AutoResizeTextarea } from "../shared/AutoResizeTextarea";
import { useCallback, useEffect, useState } from "react";
import { useAuth } from "../../../auth/useAuth";
import {
  createNote,
  getNotes,
  saveNote,
  signNote,
  type ProgressNoteRow,
} from "../../../lib/carePathwayApi";
import { formatDateTime } from "../shared/format";
import { BTN, BTN_GHOST, BTN_SM, INPUT } from "../shared/styles";
import { Card, ErrorNote, Tag } from "../shared/ui";
import { useValueSets } from "../shared/useValueSets";
import { errorText } from "../triage/helpers";

/** Progress notes for any discipline: write, sign, never edit. A correction is an
 * addendum that points at the signed note. Drafts are kept on the server. */
export function ProgressNotes({ patientId }: { patientId: string }) {
  const { accessToken, claims } = useAuth();
  const vs = useValueSets();
  const [notes, setNotes] = useState<ProgressNoteRow[]>([]);
  const [type, setType] = useState("");
  const [text, setText] = useState("");
  const [draftId, setDraftId] = useState<string | null>(null);
  // What the server holds for the note being written; anything else is unsaved.
  const [savedText, setSavedText] = useState("");
  const [amends, setAmends] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    if (!accessToken) return;
    getNotes(accessToken, patientId)
      .then((r) => setNotes(r.results))
      .catch((e) => setError(errorText(e, "Couldn't load notes.")));
  }, [accessToken, patientId]);
  useEffect(load, [load]);

  async function persist(): Promise<string | null> {
    if (!accessToken) return null;
    if (draftId) {
      await saveNote(accessToken, draftId, text);
      setSavedText(text);
      return draftId;
    }
    const created = await createNote(accessToken, patientId, {
      note_type: type,
      text,
      ...(amends ? { amends } : {}),
    });
    setDraftId(created.id);
    setSavedText(text);
    return created.id;
  }
  const unsaved = text.trim() !== "" && text !== savedText;
  const UNSAVED_TITLE = "Save or sign the note you're writing first.";

  async function act(sign: boolean) {
    setError(null);
    try {
      const id = await persist();
      if (sign && id && accessToken) {
        await signNote(accessToken, id);
        setDraftId(null);
        setSavedText("");
        setText("");
        setType("");
        setAmends(null);
      }
      load();
    } catch (e) {
      setError(errorText(e, "Couldn't save the note."));
    }
  }

  return (
    <Card title="Progress notes">
      <ErrorNote>{error}</ErrorNote>
      <div className="mb-3 flex flex-col gap-2">
        <select
          className={INPUT}
          aria-label="Note type"
          value={type}
          disabled={!!draftId}
          onChange={(e) => setType(e.target.value)}
        >
          <option value="">Note type…</option>
          {vs.options("note-type").map((o) => (
            <option key={o.code} value={o.code}>
              {o.display}
            </option>
          ))}
        </select>
        {amends && <p className="text-xs text-ink-500">Addendum to a signed note.</p>}
        <AutoResizeTextarea
          rows={4}
          aria-label="Note"
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
        <div className="flex gap-2">
          <button
            type="button"
            className={`${BTN_GHOST} ${BTN_SM}`}
            disabled={!type}
            onClick={() => void act(false)}
          >
            Save draft
          </button>
          <button
            type="button"
            className={`${BTN} ${BTN_SM}`}
            disabled={!type || !text.trim()}
            onClick={() => void act(true)}
          >
            Sign note
          </button>
        </div>
      </div>
      <ul className="flex flex-col gap-2">
        {notes.map((n) => (
          <li key={n.id} className="rounded-lg border border-surface-border p-2.5 text-[13px]">
            <div className="flex flex-wrap items-center gap-2">
              <Tag tone={n.status === "SIGNED" ? "brand" : "warn"}>
                {n.status === "SIGNED" ? "Signed" : "Draft — unsigned"}
              </Tag>
              <strong>{n.note_type_display || vs.label("note-type", n.note_type)}</strong>
              <span className="text-ink-500">
                {n.author}, {formatDateTime(n.signed_at ?? n.created_at)}
              </span>
              {n.status === "DRAFT" &&
                n.author_id === claims?.user_id &&
                n.note_type !== "PSYCHIATRY" &&
                n.id !== draftId && (
                  <button
                    type="button"
                    className={`${BTN_GHOST} ${BTN_SM}`}
                    disabled={unsaved}
                    title={unsaved ? UNSAVED_TITLE : ""}
                    onClick={() => {
                      setDraftId(n.id);
                      setType(n.note_type);
                      setAmends(n.amends);
                      setText(n.text);
                      setSavedText(n.text);
                    }}
                  >
                    Continue draft
                  </button>
                )}
              {n.status === "SIGNED" && (
                <button
                  type="button"
                  className={`${BTN_GHOST} ${BTN_SM}`}
                  // Starting an addendum would drop the draft being written.
                  disabled={unsaved}
                  title={unsaved ? UNSAVED_TITLE : ""}
                  onClick={() => {
                    setAmends(n.id);
                    // An archived type (SOAP_V3) can't be used for a new note:
                    // its addendum is filed as an ordinary progress note.
                    setType(
                      vs.options("note-type").some((o) => o.code === n.note_type)
                        ? n.note_type
                        : "PROGRESS",
                    );
                    setDraftId(null);
                    setSavedText("");
                    setText("");
                  }}
                >
                  Add addendum
                </button>
              )}
            </div>
            <p className="mt-1 whitespace-pre-wrap">{n.text}</p>
          </li>
        ))}
      </ul>
    </Card>
  );
}
