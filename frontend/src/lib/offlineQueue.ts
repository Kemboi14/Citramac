import { apiRequest } from "./apiClient";

// Local-first queue for core clinical entry screens (Triage vitals, SOAP
// notes) — docs/08-DHA-SHA-INTEGRATION.md §8.5: "so clinicians can keep
// working through a connectivity drop."
//
// Held in memory only, never in localStorage/IndexedDB: CLAUDE.md §5
// forbids browser storage for clinical data, and a queued SOAP note or set
// of vitals is exactly that. The trade-off, chosen deliberately: queued
// entries survive a network drop but not closing or reloading the tab, so
// the page asks the browser to warn before unload while anything is
// pending (see the beforeunload handler below), and the offline banner
// says to keep the tab open.

// Keys the previous localStorage-backed version wrote. Anything still there
// is moved into memory once (so unsynced work isn't lost) and the keys are
// removed, so no clinical data is left at rest in the browser.
const LEGACY_QUEUE_KEY = "citramac.offlineQueue";
const LEGACY_CONFLICTED_KEY = "citramac.offlineQueue.conflicted";

export type SyncEntityType = "VITALS" | "SOAP_NOTE";

export interface QueuedEntry {
  client_id: string;
  entity_type: SyncEntityType;
  encounter_id: string;
  base_version: number;
  payload: Record<string, unknown>;
  queued_at: string;
  /** The clinician who wrote it — only their own session ever pushes it. */
  owner_user_id: string | null;
}

interface PushResult {
  client_id: string;
  status: "APPLIED" | "CONFLICT" | "ERROR";
  server_entity_id?: string;
  version?: number;
  detail?: string;
}

let pending: QueuedEntry[] = [];
// Entries that came back CONFLICT are parked here instead of staying in the
// auto-retry queue — replaying a real conflict on every reconnect would
// just spam the server's conflict log forever without ever resolving it.
// They need a records officer, per docs/08-DHA-SHA-INTEGRATION.md §8.5, not
// automatic retry.
let conflicted: QueuedEntry[] = [];
const listeners = new Set<() => void>();

function notify() {
  listeners.forEach((listener) => listener());
}

/** Re-render hook-up for every mounted useOfflineSync, so they agree on counts. */
export function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function drainLegacyStorage() {
  try {
    const legacyPending = localStorage.getItem(LEGACY_QUEUE_KEY);
    const legacyConflicted = localStorage.getItem(LEGACY_CONFLICTED_KEY);
    if (legacyPending) {
      pending = (JSON.parse(legacyPending) as QueuedEntry[]).map((entry) => ({
        ...entry,
        owner_user_id: entry.owner_user_id ?? null,
      }));
    }
    if (legacyConflicted) conflicted = JSON.parse(legacyConflicted) as QueuedEntry[];
  } catch {
    // Unreadable leftovers can't be recovered either way; they're removed below.
  } finally {
    try {
      localStorage.removeItem(LEGACY_QUEUE_KEY);
      localStorage.removeItem(LEGACY_CONFLICTED_KEY);
    } catch {
      // Storage unavailable (private mode) — nothing was stored there then.
    }
  }
}

drainLegacyStorage();

window.addEventListener("beforeunload", (event) => {
  if (pending.length === 0) return;
  // Browsers show their own generic "leave site?" prompt; the text isn't displayed.
  event.preventDefault();
  event.returnValue = "";
});

export function queueLength(): number {
  return pending.length;
}

export function conflictedQueueLength(): number {
  return conflicted.length;
}

export function enqueue(
  entityType: SyncEntityType,
  encounterId: string,
  payload: Record<string, unknown>,
  ownerUserId: string | null,
): QueuedEntry {
  const entry: QueuedEntry = {
    client_id: crypto.randomUUID(),
    entity_type: entityType,
    encounter_id: encounterId,
    base_version: 0,
    payload,
    queued_at: new Date().toISOString(),
    owner_user_id: ownerUserId,
  };
  pending = [...pending, entry];
  notify();
  return entry;
}

/**
 * Pushes the signed-in clinician's queued entries to `/sync/push/`.
 * Applied entries are removed; conflicted ones move to the parked list
 * (surfaced to the user, not silently retried forever); errored ones stay
 * queued for the next attempt. Entries queued by someone else in this tab
 * (before a sign-out) are never sent under this user's token. Entries
 * migrated from the old storage have no recorded owner, so only a session
 * can claim them — the first sign-in after the upgrade, the same device
 * the clinician was already using.
 */
export async function flushQueue(
  accessToken: string,
  userId: string | null,
): Promise<{ applied: number; conflicts: PushResult[] }> {
  const mine = pending.filter(
    (entry) => entry.owner_user_id === null || entry.owner_user_id === userId,
  );
  if (mine.length === 0) return { applied: 0, conflicts: [] };

  const response = await apiRequest<{ results: PushResult[] }>("/sync/push/", {
    method: "POST",
    body: {
      entries: mine.map((entry) => ({
        client_id: entry.client_id,
        entity_type: entry.entity_type,
        encounter_id: entry.encounter_id,
        base_version: entry.base_version,
        payload: entry.payload,
        queued_at: entry.queued_at,
      })),
    },
    accessToken,
  });

  const resultByClientId = new Map(response.results.map((r) => [r.client_id, r]));
  const settled = new Set<string>();
  const newlyConflicted: QueuedEntry[] = [];
  const conflicts: PushResult[] = [];
  let applied = 0;

  for (const entry of mine) {
    const result = resultByClientId.get(entry.client_id);
    if (result?.status === "APPLIED") {
      applied += 1;
      settled.add(entry.client_id);
    } else if (result?.status === "CONFLICT") {
      conflicts.push(result);
      newlyConflicted.push(entry);
      settled.add(entry.client_id);
    }
  }
  pending = pending.filter((entry) => !settled.has(entry.client_id));
  if (newlyConflicted.length > 0) conflicted = [...conflicted, ...newlyConflicted];
  notify();
  return { applied, conflicts };
}
