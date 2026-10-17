import type {
  ClientFollowUps,
  DischargeChecklist,
  OutcomesOverview,
} from "../../../../lib/carePlanOutcomesApi";
import { formatDate } from "../../shared/format";
import { BTN, BTN_GHOST, BTN_SM } from "../../shared/styles";
import { Card } from "../../shared/ui";
import { useValueSets } from "../../shared/useValueSets";
import { FollowUpStats } from "./FollowUpPanel";

export type OutcomeTab = "overview" | "measures" | "discharge" | "followup";

/** The episode at a glance: outcome, discharge checklist, latest scores,
 * follow-up and earlier episodes of care. */
export function OverviewPanel({
  overview,
  checklist,
  followUps,
  onOpen,
}: {
  overview: OutcomesOverview;
  checklist: DischargeChecklist | null;
  followUps: ClientFollowUps | null;
  onOpen: (tab: OutcomeTab) => void;
}) {
  const vs = useValueSets();
  const outcome = overview.episode.outcome;
  const latest = overview.scores.slice(0, 6);
  const items = checklist?.items ?? [];
  const status = overview.episode.open ? "Active episode" : outcome ? vs.label("episode-outcome", outcome.outcome) : "No episode";

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[2fr_1fr]">
        <Card title="Episode outcome">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <div className="font-display text-lg font-bold text-ink-900">{status}</div>
              <p className="text-[13px] text-ink-500">
                Review completed measures, discharge readiness and the next scheduled contacts for this episode.
              </p>
            </div>
            <div className="text-right">
              <div className="font-display text-2xl font-bold text-ink-900">{overview.scores.length}</div>
              <div className="text-[11px] text-ink-500">measure{overview.scores.length === 1 ? "" : "s"} recorded</div>
            </div>
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            <button type="button" className={`${BTN} ${BTN_SM}`} onClick={() => onOpen("measures")}>
              Record a measure
            </button>
            <button type="button" className={`${BTN_GHOST} ${BTN_SM}`} onClick={() => onOpen("discharge")}>
              Record episode outcome
            </button>
          </div>
        </Card>
        <Card title={`Discharge checklist${items.length ? ` · ${items.filter((i) => i.ok).length}/${items.length}` : ""}`}>
          {items.length === 0 ? (
            <p className="text-[13px] text-ink-500">No open episode.</p>
          ) : (
            <ul className="flex flex-col gap-1 text-[12.5px]">
              {items.map((i) => (
                <li key={i.key} className="flex justify-between gap-2">
                  <span>{i.label}</span>
                  <span className={i.ok ? "font-semibold text-brand-green" : "text-priority-orange"}>{i.ok ? "Complete" : "Outstanding"}</span>
                </li>
              ))}
            </ul>
          )}
          <button type="button" className={`${BTN_GHOST} ${BTN_SM} mt-3`} onClick={() => onOpen("discharge")}>
            Open checklist
          </button>
        </Card>
      </div>

      {overview.summary.length > 0 && (
        <ul className="grid grid-cols-2 gap-3 md:grid-cols-4">
          {overview.summary.map((m) => (
            <li key={m.instrument} className="rounded-lg border border-surface-border bg-surface-card p-3">
              <div className="flex justify-between gap-2 text-[12px]">
                <span className="font-semibold text-ink-900">{m.name}</span>
                <span className="text-ink-500">{formatDate(m.latest.at)}</span>
              </div>
              <div className="font-display text-xl font-bold text-ink-900">
                {m.latest.score} <span className="text-[12px] font-normal text-ink-500">/ {m.max}</span>
              </div>
              <div className="text-[12px] text-ink-500">{m.latest.band || "Latest recorded score"}</div>
            </li>
          ))}
        </ul>
      )}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card title="Latest scores">
          {latest.length === 0 ? (
            <p className="text-[13px] text-ink-500">No outcome measures recorded for this client yet.</p>
          ) : (
            <ul className="flex flex-col divide-y divide-surface-border text-[13px]">
              {latest.map((s) => (
                <li key={s.id} className="flex items-center justify-between gap-2 py-1.5">
                  <div>
                    <div className="font-semibold">{s.name}</div>
                    <div className="text-[11px] text-ink-500">
                      {formatDate(s.recorded_at)}
                      {s.timepoint ? ` · ${vs.label("assessment-timepoint", s.timepoint)}` : ""}
                      {s.recorded_by ? ` · ${s.recorded_by}` : ""}
                    </div>
                  </div>
                  <span className="font-mono">{s.score} / {s.max}</span>
                </li>
              ))}
            </ul>
          )}
          <button type="button" className={`${BTN_GHOST} ${BTN_SM} mt-3`} onClick={() => onOpen("measures")}>
            View all measures
          </button>
        </Card>
        <Card title="Follow-up">
          {followUps ? (
            <>
              <FollowUpStats data={followUps} />
              <ul className="mt-2 flex flex-col divide-y divide-surface-border text-[13px]">
                {followUps.results.slice(0, 3).map((f) => (
                  <li key={f.id} className="flex justify-between gap-2 py-1.5">
                    <span>{f.reason_label || "Follow-up"}</span>
                    <span className="text-ink-500">{formatDate(f.scheduled_for)}</span>
                  </li>
                ))}
              </ul>
              {followUps.results.length === 0 && <p className="text-[13px] text-ink-500">No follow-up scheduled yet.</p>}
            </>
          ) : (
            <p className="text-[13px] text-ink-500">Loading…</p>
          )}
          <button type="button" className={`${BTN_GHOST} ${BTN_SM} mt-3`} onClick={() => onOpen("followup")}>
            Review follow-up
          </button>
        </Card>
      </div>

      {overview.previous_episodes.length > 0 && (
        <Card title="Previous episodes of care">
          <ul className="flex flex-col gap-2 text-[13px]">
            {overview.previous_episodes.map((e) => (
              <li key={e.id}>
                <strong>Episode {e.number}</strong>{" "}
                <span className="text-ink-500">
                  {formatDate(e.period_start)} → {formatDate(e.period_end)}
                </span>{" "}
                · {e.outcome ? vs.label("episode-outcome", e.outcome) : e.status}
                {e.destination ? ` → ${vs.label("episode-destination", e.destination)}` : ""}
                {e.plan_version > 0 && ` · plan v${e.plan_version}: ${e.plan_actions.join(", ") || "—"}`}
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}
