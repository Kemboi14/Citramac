const pad = (n: number) => String(n).padStart(2, "0");

/** yyyy-mm-dd HH:MM — the mockup's triage date format. */
export function formatDateTime(iso: string | null | undefined) {
  if (!iso) return "Not scheduled";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "Not scheduled";
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** HH:MM, or "time not recorded". */
export function formatTime(iso: string | null | undefined) {
  if (!iso) return "time not recorded";
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? "time not recorded"
    : `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function formatDate(iso: string | null | undefined) {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? "—"
    : `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Ksh amount with no decimals, as the mockup's billing view. */
export function formatKsh(amount: string | number) {
  return new Intl.NumberFormat("en-KE", {
    style: "currency",
    currency: "KES",
    maximumFractionDigits: 0,
  }).format(Number(amount));
}

export function newRequestId() {
  return crypto.randomUUID();
}
