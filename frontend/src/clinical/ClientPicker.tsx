import { usePatientContext } from "./usePatientContext";
import { ClientSearchBox } from "./ClientSearchBox";

/**
 * Shown by a screen that works on one client at a time (pharmacy, medication
 * administration, laboratory…) when none is chosen yet — search right here
 * instead of being sent away to another page first.
 */
export function ClientPicker({ action = "continue" }: { action?: string }) {
  const { selectPatient } = usePatientContext();
  return (
    <div className="mx-auto mt-6 max-w-xl rounded-lg border border-surface-border bg-surface-card p-6 shadow-sm">
      <h2 className="font-display text-base font-semibold text-ink-900">Choose a client</h2>
      <p className="mb-4 mt-1 text-[12.5px] text-ink-500">
        Search for the client you want to {action}. Their allergies and alerts will stay on screen
        while you work.
      </p>
      <ClientSearchBox
        autoFocus
        onChoose={(client) => selectPatient(client.id, client.name || "Temporary client")}
      />
    </div>
  );
}
