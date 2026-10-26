/**
 * The branch the user is working in, sent as `X-Branch-Id` on every API call
 * (backend apps/accounts/access.py). The server narrows records and roles to
 * it and stamps it on new episodes, appointments and encounters. "all" works
 * across every branch (Org Admin and other organisation-wide accounts only).
 * Empty = the server's default (primary branch, else the only branch).
 *
 * Remembered per browser tab in sessionStorage — a branch id, not clinical
 * data — so a reload keeps the user where they were.
 */

const STORAGE_KEY = "citramac.workingBranch";
export const ALL_BRANCHES = "all";

type Listener = (branchId: string) => void;
const listeners = new Set<Listener>();

function readStored(): string {
  try {
    return window.sessionStorage.getItem(STORAGE_KEY) ?? "";
  } catch {
    return "";
  }
}

let current = readStored();

export function getWorkingBranch(): string {
  return current;
}

export function setWorkingBranch(branchId: string) {
  if (branchId === current) return;
  current = branchId;
  try {
    if (branchId) window.sessionStorage.setItem(STORAGE_KEY, branchId);
    else window.sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    // Storage unavailable (private window) — the choice lasts for this page only.
  }
  listeners.forEach((listener) => listener(branchId));
}

export function subscribeWorkingBranch(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function workingBranchHeader(): Record<string, string> {
  return current ? { "X-Branch-Id": current } : {};
}
