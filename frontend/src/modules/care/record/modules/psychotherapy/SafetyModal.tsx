import { X } from "lucide-react";
import { useState } from "react";
import { createPortal } from "react-dom";
import { useDialogA11y } from "../../../../../components/useDialogA11y";
import type { Concern, PsyConfig, PsyNote } from "../../../../../lib/psychotherapyNoteApi";
import { BTN, BTN_GHOST, FIELD_LABEL, INPUT } from "../../../shared/styles";
import { Callout, ErrorNote } from "../../../shared/ui";

type CategoryConcern = { category: string; options: string[] };

function initialConcerns(note: PsyNote): CategoryConcern[] {
  return (note.safety_detail.concerns ?? [])
    .filter((c): c is { category: string; options?: string[] } => "category" in c)
    .map((c) => ({ category: c.category, options: c.options ?? [] }));
}

/** YES → "Document the safety concern": the eight served concern categories (with
 * optional risk-register findings for the categories that map to a register row),
 * a description, the actions-taken checklist, then link the risk record and save. */
export function SafetyModal({ config, note, onClose, onSave }: {
  config: PsyConfig;
  note: PsyNote;
  onClose: () => void;
  onSave: (body: Record<string, unknown>) => Promise<boolean>;
}) {
  const ref = useDialogA11y<HTMLDivElement>(true, onClose);
  const [concerns, setConcerns] = useState<CategoryConcern[]>(initialConcerns(note));
  const [description, setDescription] = useState(note.safety_detail.description ?? "");
  const [actions, setActions] = useState<string[]>(note.safety_detail.action_codes ?? []);
  const [other, setOther] = useState(note.safety_detail.actions ?? "");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const legacy = (note.safety_detail.concerns ?? []).filter((c) => !("category" in c)) as Concern[];

  const has = (code: string) => concerns.find((c) => c.category === code);
  function toggleCategory(code: string, on: boolean) {
    setConcerns((list) => (on ? [...list, { category: code, options: [] }] : list.filter((c) => c.category !== code)));
  }
  function toggleOption(code: string, option: string, on: boolean) {
    setConcerns((list) => list.map((c) => (c.category !== code ? c : {
      ...c, options: on ? [...c.options, option] : c.options.filter((o) => o !== option),
    })));
  }
  async function submit() {
    if (!concerns.length && !legacy.length) return setError("Choose at least one concern.");
    if (!description.trim()) return setError("Describe the concern.");
    setBusy(true);
    setError(null);
    const ok = await onSave({
      safety_detail: { concerns: [...legacy, ...concerns], description, action_codes: actions, actions: other },
      link_risk_assessment: true,
    });
    setBusy(false);
    if (ok) onClose();
    else setError("Couldn't save — check the details and try again.");
  }

  return createPortal(
    <>
      <div className="fixed inset-0 z-[110] bg-surface-scrim" onClick={onClose} />
      <div className="fixed inset-0 z-[120] flex items-center justify-center p-3 sm:p-6">
        <div ref={ref} role="dialog" aria-modal="true" aria-labelledby="psy-safety-title"
          className="flex max-h-[92vh] w-full max-w-[640px] flex-col overflow-hidden rounded-[14px] bg-surface-card shadow-md">
          <div className="flex items-start justify-between gap-3 border-b border-surface-border px-5 py-4">
            <div>
              <h2 id="psy-safety-title" className="font-display text-lg font-bold text-ink-900">Document the safety concern</h2>
              <p className="mt-0.5 text-[12.5px] text-ink-500">A safety-concern alert is placed on the client record. Findings you tick for the risk register are queued there for review.</p>
            </div>
            <button type="button" aria-label="Close" onClick={onClose}
              className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-[9px] border border-surface-border text-ink-700 hover:bg-surface-bg">
              <X className="h-4 w-4" />
            </button>
          </div>
          <div className="flex flex-col gap-4 overflow-y-auto px-5 py-4">
            <fieldset>
              <legend className={FIELD_LABEL}>Concern(s) identified today</legend>
              <div className="mt-2 grid grid-cols-1 gap-1.5 sm:grid-cols-2">
                {config.concerns.categories.map((c) => (
                  <div key={c.code} className="rounded-lg border border-surface-border px-2.5 py-2">
                    <label className="flex items-center gap-2 text-[13px] font-medium">
                      <input type="checkbox" checked={!!has(c.code)} onChange={(e) => toggleCategory(c.code, e.target.checked)} />
                      {c.label}
                    </label>
                    {has(c.code) && c.options.length > 0 && (
                      <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1 pl-6" role="group" aria-label={`${c.register_label} — for the risk register (optional)`}>
                        <span className="w-full text-[11px] text-ink-500">For the risk register ({c.register_label}) — optional</span>
                        {c.options.map((o) => (
                          <label key={o} className="flex items-center gap-1 text-[12px]">
                            <input type="checkbox" checked={!!has(c.code)?.options.includes(o)}
                              onChange={(e) => toggleOption(c.code, o, e.target.checked)} /> {o}
                          </label>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </fieldset>
            <label className="flex flex-col gap-1">
              <span className={FIELD_LABEL}>Describe the concern (required)</span>
              <textarea className={INPUT} rows={3} value={description} onChange={(e) => setDescription(e.target.value)} />
            </label>
            <fieldset>
              <legend className={FIELD_LABEL}>Actions taken</legend>
              <div className="mt-2 flex flex-col gap-1.5">
                {note.safety_action_options.map((a) => (
                  <label key={a.code} className="flex items-center gap-2 text-[13px]">
                    <input type="checkbox" checked={actions.includes(a.code)}
                      onChange={(e) => setActions((list) => (e.target.checked ? [...list, a.code] : list.filter((x) => x !== a.code)))} />
                    {a.label}
                  </label>
                ))}
              </div>
              <input className={`${INPUT} mt-2`} aria-label="Other action taken (optional)" placeholder="Other action taken (optional)"
                value={other} onChange={(e) => setOther(e.target.value)} />
            </fieldset>
            <Callout tone="warning">Complete the appropriate risk assessment and review the safety plan. The linked risk record is shown on the note.</Callout>
            <ErrorNote>{error}</ErrorNote>
          </div>
          <div className="flex justify-end gap-2 border-t border-surface-border px-5 py-3">
            <button type="button" className={BTN_GHOST} onClick={onClose}>Cancel</button>
            <button type="button" className={BTN} disabled={busy} onClick={() => void submit()}>
              {busy ? "Saving…" : "Link risk assessment & save"}
            </button>
          </div>
        </div>
      </div>
    </>,
    document.body,
  );
}
