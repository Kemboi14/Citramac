import { useEffect, useState } from "react";

/** Re-render every `ms` so a countdown stays live (BAN-10, LGL-V-WF-2). */
export function useNow(ms = 30_000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), ms);
    return () => window.clearInterval(id);
  }, [ms]);
  return now;
}

/** "41 h 12 min left" / "notice period ended" — text, never colour alone. */
export function countdownText(targetIso: string, now: number) {
  const ms = new Date(targetIso).getTime() - now;
  if (ms <= 0) return "notice period ended";
  const minutes = Math.floor(ms / 60_000);
  const hours = Math.floor(minutes / 60);
  return `${hours} h ${String(minutes % 60).padStart(2, "0")} min left`;
}
