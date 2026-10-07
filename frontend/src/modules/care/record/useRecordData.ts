import { useEffect, useRef, useState } from "react";
import { useAuth } from "../../../auth/useAuth";
import { ApiError } from "../../../lib/apiClient";

interface Loaded<T> {
  scope: string;
  version: number;
  data: T | null;
  error: string | null;
}

/**
 * Loads one API resource for a record view. `scope` identifies what is loaded
 * (e.g. the patient id); bump `version` to refetch after a save — the previous
 * data stays on screen while the refetch runs. Held in memory only (CLAUDE.md §5).
 */
export function useRecordData<T>(
  scope: string | null,
  version: number,
  load: (accessToken: string) => Promise<T>,
  failure: string,
) {
  const { accessToken } = useAuth();
  const loadRef = useRef(load);
  const failureRef = useRef(failure);
  useEffect(() => {
    loadRef.current = load;
    failureRef.current = failure;
  });
  const [state, setState] = useState<Loaded<T> | null>(null);

  useEffect(() => {
    if (!accessToken || scope === null) return;
    let cancelled = false;
    loadRef
      .current(accessToken)
      .then((data) => {
        if (!cancelled) setState({ scope, version, data, error: null });
      })
      .catch((err) => {
        if (cancelled) return;
        const error = err instanceof ApiError ? err.message : failureRef.current;
        setState((prev) => ({
          scope,
          version,
          data: prev && prev.scope === scope ? prev.data : null,
          error,
        }));
      });
    return () => {
      cancelled = true;
    };
  }, [accessToken, scope, version]);

  const current = state && state.scope === scope ? state : null;
  return {
    data: current?.data ?? null,
    error: current?.error ?? null,
    loading: !current || current.version !== version,
  };
}
