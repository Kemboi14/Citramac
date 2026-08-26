const TIER_COLOR = {
  secure: { track: "var(--green)", fill: "var(--green-tint)", text: "text-brand-green-dark" },
  good: { track: "var(--green)", fill: "var(--green-tint)", text: "text-brand-green-dark" },
  attention: { track: "var(--amber)", fill: "var(--amber-tint)", text: "text-status-amber" },
  critical: { track: "var(--red)", fill: "var(--red-tint)", text: "text-status-red" },
} as const;

function tierFor(score: number) {
  if (score >= 90) return { key: "secure", label: "Secure" } as const;
  if (score >= 80) return { key: "good", label: "Good" } as const;
  if (score >= 60) return { key: "attention", label: "Needs attention" } as const;
  return { key: "critical", label: "Critical" } as const;
}

/** Compliance score ring — citramac_SUPER-ADMIN.html `.score-ring`. */
export function ScoreRing({ score, label }: { score: number; label?: string }) {
  const tier = tierFor(score);
  const colors = TIER_COLOR[tier.key];

  return (
    <div className="flex items-center gap-3">
      <div
        className="relative flex h-[42px] w-[42px] flex-shrink-0 animate-scale-in items-center justify-center rounded-full transition-transform duration-200 hover:scale-110"
        style={{ background: `conic-gradient(${colors.track} ${score}%, ${colors.fill} 0)` }}
      >
        <div className="absolute h-[31px] w-[31px] rounded-full bg-surface-card" />
        <span className={`relative z-[1] text-[11px] font-extrabold ${colors.text}`}>{score}%</span>
      </div>
      <div className="text-xs text-ink-500">
        <b className="mb-0.5 block text-[13px] text-ink-900">{label ?? tier.label}</b>
        Compliance score
      </div>
    </div>
  );
}
