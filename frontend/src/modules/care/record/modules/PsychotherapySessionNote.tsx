import { PsychotherapyWorkspace } from "./psychotherapy/Workspace";

// Psychotherapy Session note — master prompt §7, as the chat workspace from the
// client's mockup (psychotherapy/Workspace.tsx): five guided questions, the
// mandatory safety question, server-side organising, review and sign. Opened
// from the Therapy module (client record → Interventions) and from the
// Individual Psychotherapy list; it covers the page it was opened from.
// Drafts live on the server only (X-09) — never in browser storage (CLAUDE.md §5).

/** Start or resume the clinician's draft for a therapy episode, or open a saved note by id. */
export function PsychotherapySessionNote(props: {
  patientId: string;
  episodeId?: string;
  noteId?: string;
  onClose: () => void;
}) {
  return <PsychotherapyWorkspace {...props} />;
}
