import { useEffect, useRef, useState } from "react";

/**
 * Debounced server-side autosave for a form. `value` is the draft payload as the
 * server would receive it; every change is saved `delayMs` after the last
 * keystroke through `save` (a PUT to the draft endpoint — never browser
 * storage, CLAUDE.md §5). A failed save is retried after a longer pause and
 * reported, and the browser warns before the tab closes while a change is
 * still unsaved.
 */
export function useAutosaveDraft<T>({
  value,
  save,
  delayMs = 1500,
  enabled = true,
}: {
  value: T;
  save: (value: T) => Promise<void>;
  delayMs?: number;
  enabled?: boolean;
}) {
  const serialized = JSON.stringify(value);
  const [saved, setSaved] = useState(serialized);
  const [failed, setFailed] = useState(false);
  const [savedAt, setSavedAt] = useState<Date | null>(null);
  const saveRef = useRef(save);
  useEffect(() => {
    saveRef.current = save;
  });

  useEffect(() => {
    if (!enabled || serialized === saved) return;
    const timer = window.setTimeout(
      () => {
        saveRef
          .current(JSON.parse(serialized) as T)
          .then(() => {
            setSaved(serialized);
            setFailed(false);
            setSavedAt(new Date());
          })
          .catch(() => setFailed(true));
      },
      failed ? 8000 : delayMs,
    );
    return () => window.clearTimeout(timer);
  }, [serialized, saved, enabled, delayMs, failed]);

  const dirty = serialized !== saved;
  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  /** Record that `value` reached the server by some other route (e.g. a Save button). */
  const markSaved = (savedValue: T) => {
    setSaved(JSON.stringify(savedValue));
    setFailed(false);
    setSavedAt(new Date());
  };

  return { dirty, failed, savedAt, markSaved };
}
