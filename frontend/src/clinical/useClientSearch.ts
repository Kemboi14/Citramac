import { useEffect, useState } from "react";
import { useAuth } from "../auth/useAuth";
import { ApiError } from "../lib/apiClient";
import { searchRegistrations, type RegistrationRow } from "../lib/carePathwayApi";

export type ClientSearchState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "done"; results: RegistrationRow[] }
  | { status: "error"; message: string };

const MIN_CHARS = 2;
const DEBOUNCE_MS = 250;

/**
 * Debounced client search over the registration endpoint (names, numbers and
 * dates of birth only — never clinical content). Results are held in memory
 * and dropped when the query is cleared.
 */
export function useClientSearch(query: string): ClientSearchState {
  const { accessToken } = useAuth();
  const text = query.trim();
  const [state, setState] = useState<{ for: string; value: ClientSearchState }>({
    for: "",
    value: { status: "idle" },
  });

  useEffect(() => {
    if (!accessToken || text.length < MIN_CHARS) return;
    let cancelled = false;
    const timer = window.setTimeout(() => {
      setState({ for: text, value: { status: "loading" } });
      searchRegistrations(accessToken, text)
        .then((data) => {
          if (!cancelled) setState({ for: text, value: { status: "done", results: data.results } });
        })
        .catch((err) => {
          if (cancelled) return;
          setState({
            for: text,
            value: {
              status: "error",
              message: err instanceof ApiError ? err.message : "Couldn't search clients.",
            },
          });
        });
    }, DEBOUNCE_MS);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [accessToken, text]);

  // Answers for an older query, or for a query that has since been cleared, are not shown.
  if (text.length < MIN_CHARS) return { status: "idle" };
  return state.for === text ? state.value : { status: "loading" };
}
