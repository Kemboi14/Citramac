import type { ClientBanner, TriageEncounterDetail } from "../../../lib/carePathwayApi";
import { formatDateTime } from "../shared/format";

/**
 * Mockup renderTriageEncounterContext() — Encounter · Reason for attending ·
 * Referral source · Contact / next of kin (only when recorded).
 */
export function EncounterContext({
  detail,
  banner,
}: {
  detail: TriageEncounterDetail;
  banner: ClientBanner | null;
}) {
  const showContact = Boolean(banner && (banner.phone || banner.next_of_kin));
  const block =
    "min-w-0 border-surface-border px-4 py-3.5 max-[560px]:border-t max-[560px]:first:border-t-0 min-[561px]:border-r min-[561px]:last:border-r-0";
  const label = "mb-1 text-[10px] font-bold uppercase tracking-[.06em] text-ink-500";
  const value = "break-words text-xs text-ink-900 [overflow-wrap:anywhere]";
  return (
    <section
      aria-label="Triage encounter context"
      className="mb-3.5 grid grid-cols-1 overflow-hidden rounded-lg border border-surface-border bg-surface-card shadow-sm min-[561px]:grid-cols-[repeat(auto-fit,minmax(180px,1fr))]"
    >
      <div className={block}>
        <div className={label}>Encounter</div>
        <div className={value}>
          {detail.status_label} · {formatDateTime(detail.arrival_at)} · {detail.wait_minutes} min
          waiting
        </div>
      </div>
      <div className={block}>
        <div className={label}>Reason for attending</div>
        <div className={`${value} whitespace-pre-wrap`}>
          {detail.presenting_concern || "Not yet recorded — ask client or informant"}
        </div>
      </div>
      <div className={block}>
        <div className={label}>Referral source</div>
        <div className={value}>
          {detail.referral_source || banner?.referral_source || "Not recorded"}
        </div>
      </div>
      {showContact && banner && (
        <div className={block}>
          <div className={label}>Contact / next of kin</div>
          <div className={value}>
            {banner.phone && (
              <>
                {banner.phone}
                <br />
              </>
            )}
            {banner.next_of_kin}
          </div>
        </div>
      )}
    </section>
  );
}
