import { useCallback, useEffect, useState } from "react";
import { ApiError } from "../lib/apiClient";
import { enqueue, flushQueue, queueLength, type SyncEntityType } from "../lib/offlineQueue";

interface ConflictSummary {
  client_id: string;
  detail?: string;
}

/**
 * Local-first submission for core clinical entry screens — docs/08-DHA-SHA-INTEGRATION.md
 * §8.5. `submitOrQueue` tries the normal online API call; a network-level
 * failure (not a real 4xx/5xx from the server) falls back to the offline
 * queue instead of losing the clinician's work. Auto-flushes on reconnect.
 */
export function useOfflineSync(accessToken: string | null) {
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [pendingCount, setPendingCount] = useState(queueLength());
  const [lastConflicts, setLastConflicts] = useState<ConflictSummary[]>([]);

  const flush = useCallback(async () => {
    if (!accessToken) return;
    try {
      const { conflicts } = await flushQueue(accessToken);
      setPendingCount(queueLength());
      if (conflicts.length > 0) setLastConflicts(conflicts);
    } catch {
      // Still unreachable — leave the queue as-is for the next attempt.
    }
  }, [accessToken]);

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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accessToken]);

  useEffect(() => {
    if (!accessToken || !navigator.onLine) return;
    flushQueue(accessToken)
      .then(({ conflicts }) => {
        setPendingCount(queueLength());
        if (conflicts.length > 0) setLastConflicts(conflicts);
      })
      .catch(() => {
        // Still unreachable — leave the queue as-is for the next attempt.
      });
  }, [accessToken]);

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
      enqueue(entityType, encounterId, payload);
      setPendingCount(queueLength());
      return { queued: true };
    },
    [],
  );

  return { isOnline, pendingCount, lastConflicts, submitOrQueue, flush };
}
