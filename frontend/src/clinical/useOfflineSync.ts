import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { useAuth } from "../auth/useAuth";
import { ApiError } from "../lib/apiClient";
import {
  enqueue,
  flushQueue,
  queueLength,
  subscribe,
  type SyncEntityType,
} from "../lib/offlineQueue";

interface ConflictSummary {
  client_id: string;
  detail?: string;
}

/**
 * Local-first submission for core clinical entry screens — docs/08-DHA-SHA-INTEGRATION.md
 * §8.5. `submitOrQueue` tries the normal online API call; a network-level
 * failure (not a real 4xx/5xx from the server) falls back to the in-memory
 * offline queue (lib/offlineQueue.ts) instead of losing the clinician's
 * work. Auto-flushes on reconnect. `pendingCount` is shared across every
 * screen using this hook, since they all read the one queue.
 */
export function useOfflineSync(accessToken: string | null) {
  const { claims } = useAuth();
  const userId = claims?.user_id ?? null;
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const pendingCount = useSyncExternalStore(subscribe, queueLength);
  const [lastConflicts, setLastConflicts] = useState<ConflictSummary[]>([]);
  // A flush the server *refused* (e.g. SUBSCRIPTION_EXPIRED makes the tenant
  // read-only), as opposed to one that never reached it — shown to the user
  // instead of an endless "syncing…".
  const [syncError, setSyncError] = useState<string | null>(null);

  const flush = useCallback((): Promise<void> => {
    if (!accessToken) return Promise.resolve();
    return flushQueue(accessToken, userId).then(
      ({ conflicts }) => {
        setSyncError(null);
        if (conflicts.length > 0) setLastConflicts(conflicts);
      },
      (err) => {
        // Unreachable: leave the queue as-is for the next attempt. Refused:
        // the entries stay queued too, but the user is told why.
        if (err instanceof ApiError) setSyncError(err.message);
      },
    );
  }, [accessToken, userId]);

  useEffect(() => {
    const goOnline = () => {
      setIsOnline(true);
      flush();
    };
    const goOffline = () => setIsOnline(false);
    window.addEventListener("online", goOnline);
    window.addEventListener("offline", goOffline);
    return () => {
      window.removeEventListener("online", goOnline);
      window.removeEventListener("offline", goOffline);
    };
  }, [flush]);

  useEffect(() => {
    if (navigator.onLine) flush();
  }, [flush]);

  const submitOrQueue = useCallback(
    async <T>(
      entityType: SyncEntityType,
      encounterId: string,
      payload: Record<string, unknown>,
      onlineCall: () => Promise<T>,
    ): Promise<{ queued: boolean; result?: T }> => {
      if (navigator.onLine) {
        try {
          const result = await onlineCall();
          return { queued: false, result };
        } catch (err) {
          if (err instanceof ApiError) throw err; // a real server error — surface it
          // A network-level failure (fetch never got a response) — queue it.
        }
      }
      enqueue(entityType, encounterId, payload, userId);
      return { queued: true };
    },
    [userId],
  );

  return { isOnline, pendingCount, lastConflicts, syncError, submitOrQueue, flush };
}
