import { useEffect, useState } from "react";
import { useAuth } from "../../../auth/useAuth";
import { ApiError } from "../../../lib/apiClient";
import { getClientBanner, type ClientBanner } from "../../../lib/carePathwayApi";

/** Loads the banner for a client; `reloadKey` refetches after a save. */
export function useClientBanner(patientId: string | undefined, reloadKey: unknown = 0) {
  const { accessToken } = useAuth();
  const [banner, setBanner] = useState<ClientBanner | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!accessToken || !patientId) return;
    let cancelled = false;
    getClientBanner(accessToken, patientId)
      .then((data) => {
        if (cancelled) return;
        setBanner(data);
        setError(null);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err instanceof ApiError ? err.message : "Couldn't load this client's record.");
      });
    return () => {
      cancelled = true;
    };
  }, [accessToken, patientId, reloadKey]);
  return { banner, error };
}
