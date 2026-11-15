import { useEffect, useRef, useState } from "react";
import { useAuth } from "../../../auth/useAuth";
import { ApiError } from "../../../lib/apiClient";
import {
  getClientBanner,
  getClientBannerVersion,
  type ClientBanner,
} from "../../../lib/carePathwayApi";

const CHANGED_EVENT = "citramac:client-changed";
const CHANNEL = "citramac-client-banner";
/** How often an open, visible page asks whether the banner changed. */
export const BANNER_POLL_MS = 30_000;
/** This tab. A BroadcastChannel message reaches every channel object of that
 * name, this tab's own included, which the in-page event already covers. */
const TAB_ID = Math.random().toString(36).slice(2);

/**
 * Tell every open banner for this client to reload now: on this page and in the
 * user's other tabs. Only the client's id is sent, never record content, and
 * nothing is stored (guide.md §5).
 */
export function notifyClientChanged(patientId: string) {
  window.dispatchEvent(new CustomEvent<string>(CHANGED_EVENT, { detail: patientId }));
  try {
    const channel = new BroadcastChannel(CHANNEL);
    channel.postMessage({ patientId, tab: TAB_ID });
    channel.close();
  } catch {
    // No BroadcastChannel: other tabs catch up at their next poll.
  }
}

/**
 * Loads the banner for a client and keeps it in sync. It reloads when
 * `reloadKey` changes (after a save on this page), when anything calls
 * `notifyClientChanged` for this client, and when the server's banner version
 * changes. The version is checked every BANNER_POLL_MS while the page is
 * visible and at once when the window regains focus, so a colleague's change
 * (an alert, an admission, a new care team) shows without a page reload. The
 * version check returns no record content and is not an audited read; the
 * reload it triggers is.
 */
export function useClientBanner(
  patientId: string | undefined,
  reloadKey: unknown = 0,
  includeJourney = false,
) {
  const { accessToken } = useAuth();
  const [loaded, setLoaded] = useState<{ forId: string; banner: ClientBanner } | null>(null);
  const [error, setError] = useState<{ forId: string; message: string } | null>(null);
  const [nudge, setNudge] = useState(0);
  const version = useRef<string | null>(null);

  useEffect(() => {
    if (!accessToken || !patientId) return;
    let cancelled = false;
    getClientBanner(accessToken, patientId, includeJourney)
      .then((data) => {
        if (cancelled) return;
        setLoaded({ forId: patientId, banner: data });
        setError(null);
        return getClientBannerVersion(accessToken, patientId).then((v) => {
          if (!cancelled) version.current = v.version;
        });
      })
      .catch((err) => {
        if (cancelled) return;
        // A failed background refresh keeps the banner already shown.
        setError({
          forId: patientId,
          message: err instanceof ApiError ? err.message : "Couldn't load this client's record.",
        });
      });
    return () => {
      cancelled = true;
    };
  }, [accessToken, patientId, reloadKey, includeJourney, nudge]);

  useEffect(() => {
    if (!accessToken || !patientId) return;
    version.current = null;
    let stopped = false;
    const reload = () => {
      if (!stopped) setNudge((n) => n + 1);
    };
    const check = () => {
      if (stopped || document.visibilityState !== "visible" || version.current === null) return;
      getClientBannerVersion(accessToken, patientId)
        .then((v) => {
          if (!stopped && version.current !== null && v.version !== version.current) reload();
        })
        .catch(() => {
          // Offline or signed out: try again at the next tick.
        });
    };
    const onChanged = (event: Event) => {
      if ((event as CustomEvent<string>).detail === patientId) reload();
    };
    const onVisible = () => {
      if (document.visibilityState === "visible") check();
    };
    let channel: BroadcastChannel | null = null;
    try {
      channel = new BroadcastChannel(CHANNEL);
      channel.onmessage = (message: MessageEvent<{ patientId: string; tab: string }>) => {
        if (message.data?.tab !== TAB_ID && message.data?.patientId === patientId) reload();
      };
    } catch {
      channel = null;
    }
    const timer = window.setInterval(check, BANNER_POLL_MS);
    window.addEventListener(CHANGED_EVENT, onChanged);
    window.addEventListener("focus", check);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      stopped = true;
      window.clearInterval(timer);
      window.removeEventListener(CHANGED_EVENT, onChanged);
      window.removeEventListener("focus", check);
      document.removeEventListener("visibilitychange", onVisible);
      channel?.close();
    };
  }, [accessToken, patientId]);

  // Never show one client's banner while another's is loading.
  const banner = loaded && loaded.forId === patientId ? loaded.banner : null;
  const message = error && error.forId === patientId && !banner ? error.message : null;
  return { banner, error: message };
}
