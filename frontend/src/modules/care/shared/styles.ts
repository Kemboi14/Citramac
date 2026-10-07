// Class names shared by the v3 clinical workspace screens (mockup .btn, .field, .data-table…).
import type { Priority } from "../../../lib/carePathwayApi";

export const BTN =
  "inline-flex items-center justify-center gap-1.5 rounded-[9px] border border-brand-green bg-brand-green px-4 py-2 text-[13px] font-semibold text-on-primary transition-colors duration-150 hover:border-brand-green-dark hover:bg-brand-green-dark disabled:cursor-not-allowed disabled:opacity-60";
export const BTN_GHOST =
  "inline-flex items-center justify-center gap-1.5 rounded-[9px] border border-surface-border bg-surface-card px-4 py-2 text-[13px] font-semibold text-ink-900 transition-colors duration-150 hover:bg-surface-bg disabled:cursor-not-allowed disabled:opacity-60";
export const BTN_SM = "!px-3 !py-1 !text-xs";
export const BTN_DANGER =
  "inline-flex items-center justify-center gap-1.5 rounded-[9px] border border-priority-red bg-priority-red px-4 py-2 text-[13px] font-semibold text-on-status hover:opacity-90";
export const INPUT =
  "w-full min-w-0 rounded-lg border border-surface-border bg-surface-bg px-2.5 py-2 text-[13px] text-ink-900 outline-none transition-colors duration-150 focus:border-brand-green focus:bg-surface-card disabled:opacity-70 read-only:bg-surface-bg read-only:text-ink-700";
export const FIELD_LABEL = "text-[11px] font-semibold uppercase tracking-wide text-ink-500";
export const GROUP_LABEL =
  "mb-2 mt-[18px] text-[11px] font-bold uppercase tracking-wide text-ink-500";
export const TH =
  "border-b border-surface-border bg-surface-bg px-3.5 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wide text-ink-500";
export const TD = "border-b border-surface-border px-3.5 py-2.5 align-top text-[13px] text-ink-900";
export const TABLE = "w-full border-collapse";

/** Left-edge colour for a priority-striped row or card. */
export const PRIORITY_EDGE: Record<Priority, string> = {
  RED: "border-l-priority-red",
  ORANGE: "border-l-priority-orange",
  YELLOW: "border-l-priority-yellow",
  GREEN: "border-l-priority-green",
};
