import {
  SESSION_TABS,
  sessionDateLabel,
  sessionStatus,
  type SessionTab,
  type WorkspaceItem,
} from "./model";
import { CHIP, STATUS_CHIP } from "./styles";

/** The mockup's .group-workspace-rail: new-session button, period tabs, session list. */
export function SessionRail({
  items,
  tab,
  selectedKey,
  onTab,
  onSelect,
}: {
  items: WorkspaceItem[];
  tab: SessionTab;
  selectedKey: string | null;
  onTab: (tab: SessionTab) => void;
  onSelect: (key: string) => void;
}) {
  return (
    <aside className="flex min-w-0 flex-col overflow-hidden rounded-xl border border-surface-border bg-surface-card max-lg:max-h-[320px]">
      <div className="flex gap-1 px-3 pb-1.5 pt-3" role="tablist" aria-label="Filter sessions">
        {SESSION_TABS.map(([key, label]) => (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={tab === key}
            onClick={() => onTab(key)}
            className={`rounded-full px-3 py-[7px] text-xs ${
              tab === key ? "bg-brand-green-tint font-bold text-brand-green" : "text-ink-500"
            }`}
          >
            {label}
          </button>
        ))}
      </div>
      <div className="grid content-start gap-1.5 overflow-auto px-3 pb-4 pt-1 lg:max-h-[calc(100vh-280px)]">
        {items.length ? (
          items.map((item) => {
            const status = sessionStatus(item);
            const current = item.key === selectedKey;
            return (
              <button
                key={item.key}
                type="button"
                aria-current={current}
                onClick={() => onSelect(item.key)}
                className={`grid w-full gap-1 rounded-xl border px-3.5 py-[13px] text-left text-ink-900 transition-colors duration-150 ${
                  current
                    ? "border-brand-green bg-brand-green-tint"
                    : "border-transparent hover:bg-surface-bg"
                }`}
              >
                <span className="flex flex-wrap items-center justify-between gap-2.5 text-[11px] tabular-nums text-ink-500">
                  <span>
                    {sessionDateLabel(item.date)} · {item.time || "Time not set"}
                  </span>
                  <StatusChip label={status.label} tone={status.tone} />
                </span>
                <span className="text-[13px] font-bold">{item.topic}</span>
                <span className="text-[11px] text-ink-500">
                  {item.category} · {item.facilitator}
                </span>
              </button>
            );
          })
        ) : (
          <p className="p-6 text-center text-xs text-ink-500">No sessions in this list.</p>
        )}
      </div>
    </aside>
  );
}

export function StatusChip({ label, tone }: ReturnType<typeof sessionStatus>) {
  return (
    // eslint-disable-next-line security/detect-object-injection -- `tone` is a typed union.
    <span className={`${CHIP} ${STATUS_CHIP[tone]} inline-flex items-center`}>
      {tone === "live" && (
        <span
          aria-hidden="true"
          className="mr-[5px] inline-block h-[7px] w-[7px] rounded-full bg-current motion-safe:animate-pulse"
        />
      )}
      {label}
    </span>
  );
}
