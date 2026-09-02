import { useAuth } from "../auth/useAuth";
import { useOfflineSync } from "../clinical/useOfflineSync";

/**
 * Connectivity + pending-sync indicator for clinical entry screens —
 * docs/08-DHA-SHA-INTEGRATION.md §8.5. Shown globally in the clinical
 * workspace shell since any of Triage/SOAP-note entry can queue work.
 */
export function OfflineSyncBanner() {
  const { accessToken } = useAuth();
  const { isOnline, pendingCount, lastConflicts } = useOfflineSync(accessToken);

  if (isOnline && pendingCount === 0 && lastConflicts.length === 0) return null;

  if (!isOnline) {
    return (
      <div className="mb-4 flex items-center gap-2 rounded-sm bg-status-amber-tint px-3 py-2 text-sm font-medium text-status-amber">
        Offline — entries are being saved on this device
        {pendingCount > 0 && ` (${pendingCount} pending)`} and will sync once you&apos;re back
        online.
      </div>
    );
  }

  if (pendingCount > 0) {
    return (
      <div className="mb-4 flex items-center gap-2 rounded-sm bg-brand-green-tint px-3 py-2 text-sm font-medium text-brand-green-dark">
        Back online — syncing {pendingCount} queued entr{pendingCount === 1 ? "y" : "ies"}…
      </div>
    );
  }

  return (
    <div className="mb-4 flex items-center gap-2 rounded-sm bg-status-red-tint px-3 py-2 text-sm font-medium text-status-red">
      {lastConflicts.length} entr{lastConflicts.length === 1 ? "y" : "ies"} couldn&apos;t sync
      automatically and need a records officer to resolve them.
    </div>
  );
}
