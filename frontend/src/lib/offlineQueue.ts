import { apiRequest } from "./apiClient";

// Local-first queue for core clinical entry screens (Triage vitals, SOAP
// notes) — docs/08-DHA-SHA-INTEGRATION.md §8.5: "so clinicians can keep
// working through a connectivity drop." Backed by localStorage (not
// IndexedDB) to keep this dependency-free; entries are small JSON blobs so
// the storage-quota tradeoff is fine for this scope.

const QUEUE_KEY = "citramac.offlineQueue";
// Entries that came back CONFLICT are parked here instead of staying in the
// auto-retry queue — replaying a real conflict on every reconnect would
// just spam the server's conflict log forever without ever resolving it.
// They need a records officer, per docs/08-DHA-SHA-INTEGRATION.md §8.5, not
// automatic retry.
const CONFLICTED_KEY = "citramac.offlineQueue.conflicted";

export type SyncEntityType = "VITALS" | "SOAP_NOTE";

export interface QueuedEntry {
  client_id: string;
  entity_type: SyncEntityType;
  encounter_id: string;
  base_version: number;
  payload: Record<string, unknown>;
  queued_at: string;
}

interface PushResult {
  client_id: string;
  status: "APPLIED" | "CONFLICT" | "ERROR";
  server_entity_id?: string;
  version?: number;
  detail?: string;
}

function readList(key: string): QueuedEntry[] {
  const raw = localStorage.getItem(key);
  return raw ? (JSON.parse(raw) as QueuedEntry[]) : [];
}

function writeList(key: string, entries: QueuedEntry[]) {
  localStorage.setItem(key, JSON.stringify(entries));
}

export function queueLength(): number {
  return readList(QUEUE_KEY).length;
}

export function conflictedQueueLength(): number {
  return readList(CONFLICTED_KEY).length;
}

export function enqueue(
  entityType: SyncEntityType,
  encounterId: string,
  payload: Record<string, unknown>,
): QueuedEntry {
  const entry: QueuedEntry = {
    client_id: crypto.randomUUID(),
    entity_type: entityType,
    encounter_id: encounterId,
    base_version: 0,
    payload,
    queued_at: new Date().toISOString(),
  };
  writeList(QUEUE_KEY, [...readList(QUEUE_KEY), entry]);
  return entry;
}

/**
 * Pushes every queued entry to `/sync/push/`. Applied entries are removed;
 * conflicted ones move to the parked/conflicted list (surfaced to the user,
 * not silently retried forever); errored ones stay queued for the next
 * attempt.
 */
export async function flushQueue(accessToken: string): Promise<{
  applied: number;
  conflicts: PushResult[];
}> {
  const pending = readList(QUEUE_KEY);
  if (pending.length === 0) return { applied: 0, conflicts: [] };

  const response = await apiRequest<{ results: PushResult[] }>("/sync/push/", {
    method: "POST",
    body: { entries: pending },
    accessToken,
  });

  const resultByClientId = new Map(response.results.map((r) => [r.client_id, r]));
  const remaining: QueuedEntry[] = [];
  const newlyConflicted: QueuedEntry[] = [];
  const conflicts: PushResult[] = [];
  let applied = 0;

  for (const entry of pending) {
    const result = resultByClientId.get(entry.client_id);
    if (result?.status === "APPLIED") {
      applied += 1;
    } else if (result?.status === "CONFLICT") {
      conflicts.push(result);
      newlyConflicted.push(entry);
    } else {
      remaining.push(entry);
    }
  }
  writeList(QUEUE_KEY, remaining);
  if (newlyConflicted.length > 0) {
    writeList(CONFLICTED_KEY, [...readList(CONFLICTED_KEY), ...newlyConflicted]);
  }
  return { applied, conflicts };
}
