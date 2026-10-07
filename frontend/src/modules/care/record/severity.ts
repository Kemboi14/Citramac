// Severity bands for the PHQ-9 and GAD-7 total scores, kept in this one
// constant. Approved by the project owner on 2026-10-07 (docs/15 §4). They
// label a score only; they drive no clinical decision or alert.
export const SCORE_SEVERITY_BANDS = {
  GAD7: {
    label: "GAD-7",
    max: 21,
    bands: [
      { upTo: 4, label: "Minimal" },
      { upTo: 9, label: "Mild" },
      { upTo: 14, label: "Moderate" },
      { upTo: 21, label: "Severe" },
    ],
  },
  PHQ9: {
    label: "PHQ-9",
    max: 27,
    bands: [
      { upTo: 4, label: "Minimal" },
      { upTo: 9, label: "Mild" },
      { upTo: 14, label: "Moderate" },
      { upTo: 19, label: "Moderately severe" },
      { upTo: 27, label: "Severe" },
    ],
  },
} as const;

export type Instrument = keyof typeof SCORE_SEVERITY_BANDS;

/** Band label for a score, or "" when the score is missing or out of range. */
export function scoreSeverity(instrument: Instrument, score: number | null | undefined) {
  if (score === null || score === undefined || Number.isNaN(score)) return "";
  // eslint-disable-next-line security/detect-object-injection -- `instrument` is a typed union.
  const scale = SCORE_SEVERITY_BANDS[instrument];
  if (score < 0 || score > scale.max) return "";
  return scale.bands.find((band) => score <= band.upTo)?.label ?? "";
}

/** Tag tone for a severity label: the two upper bands read as risk. */
export function severityTone(label: string): "neutral" | "warn" | "risk" {
  if (label === "Severe" || label === "Moderately severe") return "risk";
  if (label === "Moderate") return "warn";
  return "neutral";
}
