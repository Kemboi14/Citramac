import { useId, useState } from "react";
import { getClientTimeline, type TimelineEvent } from "../../../lib/carePathwayApi";
import { formatDate, formatTime } from "../shared/format";
import { INPUT } from "../shared/styles";
import { Card, ErrorNote, Timeline } from "../shared/ui";
import type { RecordViewProps } from "./types";
import { useRecordData } from "./useRecordData";

/** Filter chips → the timeline `kind`s each one shows. */
const FILTERS = [
  { key: "all", label: "All", kinds: [] },
  { key: "triage", label: "Triage", kinds: ["registration", "arrival", "triage", "recheck"] },
  { key: "vitals", label: "Vitals", kinds: ["vitals"] },
  { key: "alerts", label: "Alerts", kinds: ["alert"] },
  { key: "admissions", label: "Admissions", kinds: ["admission", "discharge"] },
  { key: "notes", label: "Clinical notes", kinds: ["intake", "intervention", "diagnosis"] },
  { key: "appointments", label: "Appointments", kinds: ["appointment"] },
  { key: "episode", label: "Episode", kinds: ["episode"] },
  { key: "consent", label: "Consent", kinds: ["consent"] },
  { key: "tasks", label: "Tasks", kinds: ["task"] },
] as const;
type FilterKey = (typeof FILTERS)[number]["key"];

const time = (event: TimelineEvent) => (event.at ? new Date(event.at).getTime() || 0 : 0);

/** Timeline — every recorded event for the client, newest first, grouped by day. */
export function TimelineView({ patientId }: RecordViewProps) {
  const searchId = useId();
  const [filter, setFilter] = useState<FilterKey>("all");
  const [search, setSearch] = useState("");
  const { data, error, loading } = useRecordData(
    patientId,
    0,
    (token) => getClientTimeline(token, patientId),
    "Couldn't load the client timeline.",
  );

  const all = [...(data?.results ?? [])].sort((a, b) => time(b) - time(a));
  const kindsFor = (key: FilterKey): readonly string[] =>
    FILTERS.find((f) => f.key === key)?.kinds ?? [];
  const countFor = (key: FilterKey) => {
    const kinds = kindsFor(key);
    return key === "all" ? all.length : all.filter((e) => kinds.includes(e.kind)).length;
  };
  const kinds = kindsFor(filter);
  const term = search.trim().toLowerCase();
  const events = all.filter(
    (e) =>
      (filter === "all" || kinds.includes(e.kind)) &&
      (!term || `${e.title} ${e.detail}`.toLowerCase().includes(term)),
  );

  const groups: { date: string; events: TimelineEvent[] }[] = [];
  for (const event of events) {
    const date = event.at ? formatDate(event.at) : "Date not recorded";
    const last = groups.at(-1);
    if (last && last.date === date) last.events.push(event);
    else groups.push({ date, events: [event] });
  }

  return (
    <Card
      title="Timeline"
      aside={
        data ? (
          <span className="text-[11px] font-medium text-ink-500">
            {events.length} of {all.length} {all.length === 1 ? "event" : "events"}
          </span>
        ) : undefined
      }
    >
      <ErrorNote>{error}</ErrorNote>
      <div className="mb-4 flex flex-col gap-3">
        <div role="group" aria-label="Filter events by type" className="flex flex-wrap gap-1.5">
          {FILTERS.map((f) => {
            const active = filter === f.key;
            return (
              <button
                key={f.key}
                type="button"
                aria-pressed={active}
                onClick={() => setFilter(f.key)}
                className={`rounded-full border px-3 py-1 text-xs font-semibold transition-colors duration-150 ${
                  active
                    ? "border-brand-green bg-brand-green text-on-primary"
                    : "border-surface-border bg-surface-card text-ink-700 hover:bg-surface-bg"
                }`}
              >
                {f.label}{" "}
                <span className={active ? "opacity-80" : "text-ink-400"}>{countFor(f.key)}</span>
              </button>
            );
          })}
        </div>
        <div className="max-w-sm">
          <label htmlFor={searchId} className="sr-only">
            Search the timeline
          </label>
          <input
            id={searchId}
            type="search"
            className={INPUT}
            placeholder="Search events…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
      </div>

      {loading && !data ? (
        <p className="text-[13px] text-ink-500">Loading timeline…</p>
      ) : groups.length > 0 ? (
        <div className="flex flex-col gap-5">
          {groups.map((group) => (
            <section key={group.date} aria-label={group.date}>
              <h3 className="mb-2 font-mono text-xs font-bold text-ink-700">{group.date}</h3>
              <Timeline
                items={group.events.map((event, index) => ({
                  key: `${event.kind}-${event.at}-${index}`,
                  time: formatTime(event.at),
                  title: event.title,
                  detail: event.detail,
                }))}
              />
            </section>
          ))}
        </div>
      ) : (
        data && (
          <p className="text-[13px] text-ink-500">
            {all.length === 0
              ? "No events recorded for this client yet."
              : "No events match this filter."}
          </p>
        )
      )}
    </Card>
  );
}
