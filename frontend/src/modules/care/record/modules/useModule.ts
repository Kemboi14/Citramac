import { useCallback, useEffect, useState } from "react";
import { useAuth } from "../../../../auth/useAuth";
import { errorText } from "../../triage/helpers";

/** Shared load/act plumbing for the record modules: reload after every
 * successful write, show the server's message on failure. */
export function useModule<T>(patientId: string, fetcher: (token: string, id: string) => Promise<T>) {
  const { accessToken } = useAuth();
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(() => {
    if (!accessToken) return;
    fetcher(accessToken, patientId).then(setData).catch((e) => setError(errorText(e, "Couldn't load.")));
  }, [accessToken, patientId, fetcher]);
  useEffect(load, [load]);
  async function act(work: (token: string) => Promise<unknown>) {
    if (!accessToken) return false;
    setError(null);
    try {
      await work(accessToken);
      load();
      return true;
    } catch (e) {
      setError(errorText(e, "Couldn't save."));
      return false;
    }
  }
  return { data, error, act, token: accessToken };
}
