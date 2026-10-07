import { useEffect, useState } from "react";
import { useAuth } from "../../../auth/useAuth";
import { getValueSets, type ValueSet, type ValueSetConcept } from "../../../lib/carePathwayApi";

// Served value sets (CLAUDE.md §4 "Terminology is served, not compiled"), loaded
// once per page session and held in memory only — never browser storage.
let cache: Record<string, ValueSet> | null = null;
let inflight: Promise<Record<string, ValueSet>> | null = null;

function loadAll(accessToken: string) {
  if (cache) return Promise.resolve(cache);
  if (!inflight) {
    inflight = getValueSets(accessToken, [])
      .then((sets) => {
        cache = sets;
        return sets;
      })
      .finally(() => {
        inflight = null;
      });
  }
  return inflight;
}

export interface ValueSetsApi {
  ready: boolean;
  error: string | null;
  /** Active concepts of a value set, in served order ([] while loading). */
  options: (id: string) => ValueSetConcept[];
  /** Display text for a code; falls back to the code itself. */
  label: (id: string, code: string | null | undefined) => string;
}

export function useValueSets(): ValueSetsApi {
  const { accessToken } = useAuth();
  const [sets, setSets] = useState<Record<string, ValueSet> | null>(cache);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (cache || !accessToken) return;
    let cancelled = false;
    loadAll(accessToken)
      .then((loaded) => !cancelled && setSets(loaded))
      .catch(
        () =>
          !cancelled &&
          setError("Couldn't load the clinical option lists. Reload the page to try again."),
      );
    return () => {
      cancelled = true;
    };
  }, [accessToken]);

  return {
    ready: sets !== null,
    error,
    options: (id) => sets?.[id]?.concepts ?? [],
    label: (id, code) => {
      if (!code) return "";
      return sets?.[id]?.concepts.find((c) => c.code === code)?.display ?? code;
    },
  };
}
