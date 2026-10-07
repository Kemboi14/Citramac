import { Clock } from "lucide-react";
import { getClientTimeline, type TimelineEvent } from "../../../lib/carePathwayApi";
import { formatDateTime } from "../shared/format";
import { Timeline } from "../shared/ui";
import { useRecordData } from "./useRecordData";

const time = (event: TimelineEvent) => (event.at ? new Date(event.at).getTime() || 0 : 0);

/**
 * "Information Trail" side panel (mockup `clinical()`): where each item was
 * first captured — registration, triage, vitals, risk flags.
 */
export function InformationTrail({ patientId, version }: { patientId: string; version: number }) {
  const { data, error } = useRecordData(
    patientId,
    version,
    (token) => getClientTimeline(token, patientId),
    "Couldn't load the information trail.",
  );
  const events = data?.results ?? [];
  const ofKind = (kind: string) =>
    events.filter((e) => e.kind === kind).sort((a, b) => time(a) - time(b));
  const registration = ofKind("registration")[0];
  const triage = ofKind("triage").at(-1);
  const vitals = ofKind("vitals").at(-1);
  const alerts = ofKind("alert");

  const items = [
    registration
      ? {
          key: "registration",
          time: formatDateTime(registration.at),
          title: registration.title,
          detail: registration.detail,
        }
      : { key: "registration", time: "—", title: "Registration", detail: "Not recorded" },
    triage
      ? {
          key: "triage",
          time: formatDateTime(triage.at),
          title: triage.title,
          detail: triage.detail,
        }
      : { key: "triage", time: "—", title: "Triage", detail: "No signed triage yet" },
    vitals
      ? {
          key: "vitals",
          time: formatDateTime(vitals.at),
          title: vitals.title,
          detail: vitals.detail || "No values recorded",
        }
      : { key: "vitals", time: "—", title: "Vitals", detail: "No vitals recorded" },
    {
      key: "alerts",
      time: alerts.length ? formatDateTime(alerts[0].at) : "—",
      title: "Risk flags identified",
      detail: alerts.map((a) => a.detail).join(", ") || "None recorded",
    },
  ];

  return (
    <aside
      aria-label="Information Trail"
      className="rounded-lg border border-surface-border bg-surface-card shadow-sm lg:sticky lg:top-32"
    >
      <div className="flex items-center gap-[9px] border-b border-surface-border px-3.5 py-3 text-xs font-bold uppercase text-ink-900">
        <Clock className="h-[15px] w-[15px] text-brand-green" aria-hidden="true" />
        Information Trail
      </div>
      <div className="px-3.5 pb-1 pt-2.5 text-[11.5px] text-ink-500">
        Every item shows where it was first captured. Nothing is entered twice.
      </div>
      <div className="p-[18px]">
        {error && !data ? (
          <p className="text-xs text-status-red">{error}</p>
        ) : !data ? (
          <p className="text-xs text-ink-500">Loading…</p>
        ) : (
          <Timeline items={items} />
        )}
      </div>
    </aside>
  );
}
