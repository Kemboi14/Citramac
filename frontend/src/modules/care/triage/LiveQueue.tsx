import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../../../auth/useAuth";
import {
  getLiveQueue,
  type LiveQueue as LiveQueueData,
  type LiveQueueRow,
  type QueueLane,
} from "../../../lib/triageV4Api";
import { formatDateTime, formatTime } from "../shared/format";
import { clientRecordPath } from "../shared/recordRoutes";
import { BTN_GHOST, BTN_SM, PRIORITY_EDGE, TABLE, TD, TH } from "../shared/styles";
import { ErrorNote, PriorityPill, Tag } from "../shared/ui";
import { errorText } from "./helpers";

// v4 mockup renderQueue() / queueRow() / tickQueue(): four lanes, ordered by
// clinical priority then time waiting. Waits re-draw every 30 s from the local
// clock without moving focus or scroll; the data refreshes every 60 s. Queue
// privacy (on by default — the screen may be visible at reception) shows
// initials and the last three digits of the record number, and a neutral
// "Safety alerts · n" instead of the alert text.

const TICK_MS = 30_000;
const REFRESH_MS = 60_000;
type Filter = "all" | "mine" | "team" | "unassigned";
const FILTERS: [Filter, string][] = [
  ["all", "All"],
  ["mine", "My clients"],
  ["team", "With a team"],
  ["unassigned", "Unassigned"],
];
const LANES: { lane: QueueLane; title: string; empty: string }[] = [
  { lane: "awaiting", title: "Awaiting triage", empty: "No one awaiting triage." },
  {
    lane: "waiting",
    title: "Triaged — waiting to be seen (clinical priority, then time)",
    empty: "No one waiting to be seen.",
  },
  { lane: "in_care", title: "In care today", empty: "No one in active care." },
  { lane: "discharged", title: "Discharged — in follow-up", empty: "" },
];
const TONE = { risk: "risk", warn: "warn", info: "neutral" } as const;

function liveWait(row: LiveQueueRow, now: number) {
  const minutes = Math.max(0, Math.floor((now - new Date(row.arrival_at).getTime()) / 60000));
  const target = row.wait.target;
  const frac = target === null ? 0 : target === 0 ? 1 : Math.min(1, minutes / target);
  const over = target !== null && (target === 0 ? row.lane === "waiting" : minutes > target);
  return { minutes, target, frac, over };
}

export function LiveQueue({
  onOpenReview,
  opening,
}: {
  onOpenReview?: (row: LiveQueueRow) => void;
  opening?: string | null;
}) {
  const { accessToken, claims } = useAuth();
  const navigate = useNavigate();
  const [data, setData] = useState<LiveQueueData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [privacy, setPrivacy] = useState(true);
  const [filter, setFilter] = useState<Filter>("all");

  useEffect(() => {
    if (!accessToken) return;
    let cancelled = false;
    const load = () =>
      getLiveQueue(accessToken)
        .then((d) => {
          if (cancelled) return;
          setData(d);
          setError(null);
          setNow(Date.now());
        })
        .catch((err) => !cancelled && setError(errorText(err, "Couldn't refresh the live queue.")));
    load();
    const refresh = window.setInterval(load, REFRESH_MS);
    const tick = window.setInterval(() => setNow(Date.now()), TICK_MS);
    return () => {
      cancelled = true;
      window.clearInterval(refresh);
      window.clearInterval(tick);
    };
  }, [accessToken]);

  const me = claims?.user_id;
  const keep = (row: LiveQueueRow) =>
    filter === "mine"
      ? row.owner?.id === me
      : filter === "team"
        ? Boolean(row.team)
        : filter === "unassigned"
          ? !row.owner
          : true;

  const overCount = data
    ? [...data.lanes.awaiting, ...data.lanes.waiting].filter((r) => liveWait(r, now).over).length
    : 0;

  const open = (row: LiveQueueRow) => {
    if (row.lane === "awaiting" || row.lane === "waiting") navigate(`/clinical/triage/${row.id}`);
    else navigate(clientRecordPath(row.patient_id, "snapshot"));
  };

  const renderRow = (row: LiveQueueRow) => {
    const w = liveWait(row, now);
    const chips = row.attention;
    const show = chips.slice(0, 2);
    const extra = chips.slice(2);
    const chipLabel = (c: (typeof chips)[number]) =>
      c.key === "alerts"
        ? privacy
          ? `Safety alerts · ${c.count ?? 1}`
          : `${c.label}${(c.count ?? 1) > 1 ? ` +${(c.count ?? 1) - 1}` : ""}`
        : c.label;
    const obs = row.observation;
    return (
      <tr key={row.id} className={w.over && !row.seen_at ? "bg-priority-red-tint/30" : ""}>
        <td className={`${TD} border-l-4 ${row.priority ? PRIORITY_EDGE[row.priority] : "border-l-surface-border"}`}>
          <PriorityPill priority={row.priority} />
        </td>
        <td className={TD}>
          <button type="button" className="text-left font-semibold text-brand-green hover:underline" onClick={() => open(row)}>
            {privacy ? row.privacy_name : row.name || "Unidentified client"}
          </button>
          <span className="block text-[11px] text-ink-500">
            {row.citramac_number || "no number yet"} · {row.age ?? "?"}/{row.sex || "?"} · arrived{" "}
            {formatTime(row.arrival_at)}
            {row.triage_version > 1 ? ` · triage v${row.triage_version}` : ""}
          </span>
        </td>
        <td className={`${TD} min-w-[150px]`}>
          {row.lane === "discharged" ? (
            <span className="text-[12px]">
              {row.next_follow_up ? `next follow-up ${formatDateTime(row.next_follow_up)}` : "no follow-up due"}
            </span>
          ) : (
            <>
              <span className={`text-[12px] ${w.over ? "font-semibold text-priority-red" : ""}`}>
                {w.minutes} min
                {w.target === null ? "" : w.target === 0 ? " · see now" : ` · target ${w.target}`}
              </span>
              {w.target !== null && (
                <div
                  className="mt-1 h-1.5 w-full overflow-hidden rounded bg-surface-bg"
                  role="img"
                  aria-label={`${Math.round(w.frac * 100)}% of target used`}
                >
                  <span
                    className={`block h-full ${w.over ? "bg-priority-red" : w.frac > 0.75 ? "bg-priority-orange" : "bg-brand-green"}`}
                    style={{ width: `${Math.round(w.frac * 100)}%` }}
                  />
                </div>
              )}
            </>
          )}
        </td>
        <td className={`${TD} text-[12.5px]`}>
          {row.next_action ? (
            <span className={row.next_action.overdue ? "font-semibold text-priority-red" : ""}>
              {row.next_action.text}
            </span>
          ) : (
            "—"
          )}
          {row.lane === "waiting" && onOpenReview && (
            <button
              type="button"
              className={`${BTN_GHOST} ${BTN_SM} mt-1.5 block`}
              disabled={opening != null}
              onClick={() => onOpenReview(row)}
            >
              {opening === row.id ? "Opening…" : "Open review"}
            </button>
          )}
        </td>
        <td className={`${TD} text-[12.5px]`}>
          {!obs ? "—" : obs.off_site ? "Off site" : (
            <>
              {obs.level || "—"}
              <span className="block text-[11px] text-ink-500">
                {obs.location}
                {obs.observer && !privacy ? ` · ${obs.observer}` : ""}
              </span>
            </>
          )}
        </td>
        <td className={`${TD} text-[12.5px]`}>{row.owner ? row.owner.name : row.team ? row.team : <span className="text-ink-500">Unassigned</span>}</td>
        <td className={TD}>
          <div className="flex flex-wrap gap-1">
            {show.map((c) => (
              <span key={c.key} title={c.key === "alerts" && privacy ? "Neutral display — open the record for details" : undefined}>
                <Tag tone={TONE[c.tone]}>{chipLabel(c)}</Tag>
              </span>
            ))}
          </div>
          {extra.length > 0 && (
            <details className="mt-1">
              <summary className="cursor-pointer text-[11px] text-ink-500">+{extra.length} more</summary>
              <div className="mt-1 flex flex-wrap gap-1">
                {extra.map((c) => (
                  <Tag key={c.key} tone={TONE[c.tone]}>
                    {chipLabel(c)}
                  </Tag>
                ))}
              </div>
            </details>
          )}
        </td>
      </tr>
    );
  };

  return (
    <section aria-label="Live queue">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <div role="group" aria-label="Filter queue" className="inline-flex overflow-hidden rounded-lg border border-surface-border">
          {FILTERS.map(([key, label]) => (
            <button
              key={key}
              type="button"
              aria-pressed={filter === key}
              className={`px-3 py-1.5 text-[12.5px] font-semibold ${filter === key ? "bg-brand-green text-on-primary" : "bg-surface-card text-ink-900"}`}
              onClick={() => setFilter(key)}
            >
              {label}
            </button>
          ))}
        </div>
        <button type="button" aria-pressed={privacy} className={`${BTN_GHOST} ${BTN_SM}`} onClick={() => setPrivacy((p) => !p)}>
          Queue privacy: {privacy ? "on" : "off"}
        </button>
      </div>
      <p role="status" aria-live="polite" className="mb-2 text-[12.5px] text-ink-700">
        {overCount ? `${overCount} client${overCount > 1 ? "s" : ""} over their target time.` : "All waiting clients are within target."}{" "}
        <span className="text-ink-500">
          Targets: {data?.targets_approval ?? "illustrative — from client mockup, VERIFY"}.
        </span>
      </p>
      <ErrorNote>{error}</ErrorNote>
      {LANES.map(({ lane, title, empty }) => {
        const rows = (data?.lanes[lane] ?? []).filter(keep);
        if (lane === "discharged" && rows.length === 0) return null;
        return (
          <div key={lane} className="mb-5">
            <h3 className="mb-1.5 text-[13px] font-bold text-ink-900">
              {title} <span className="font-normal text-ink-500">· {rows.length}</span>
            </h3>
            {rows.length === 0 ? (
              <p className="rounded-lg border border-dashed border-surface-border px-4 py-3 text-[13px] text-ink-500">
                {data ? empty : "Loading…"}
              </p>
            ) : (
              <div className="overflow-x-auto rounded-lg border border-surface-border">
                <table className={`${TABLE} min-w-[920px]`}>
                  <thead>
                    <tr>
                      <th className={TH}>Priority</th>
                      <th className={TH}>Client</th>
                      <th className={TH}>Wait vs target</th>
                      <th className={TH}>Next action</th>
                      <th className={TH}>Obs / location</th>
                      <th className={TH}>Owner</th>
                      <th className={TH}>Attention</th>
                    </tr>
                  </thead>
                  <tbody>{rows.map(renderRow)}</tbody>
                </table>
              </div>
            )}
          </div>
        );
      })}
    </section>
  );
}
