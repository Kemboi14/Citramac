/** Module icons — the v4 workflow's CARE_MENU `icon` paths, keyed by module code. */
const PATHS = new Map<string, string[]>(Object.entries({
  emergency_care: ["M3 12h4l2 5 4-12 2 7h6"],
  observation_safety: ["M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z", "C12 12 3"],
  blood_work: ["M12 2s5.5 6.2 5.5 10.5a5.5 5.5 0 0 1-11 0C6.5 8.2 12 2 12 2Z"],
  medical_review: [
    "M4.8 2.3A.3.3 0 1 0 5 2H4a2 2 0 0 0-2 2v5a6 6 0 0 0 6 6 6 6 0 0 0 6-6V4a2 2 0 0 0-2-2h-1a.2.2 0 1 0 .3.3",
    "M8 15v1a6 6 0 0 0 6 6 6 6 0 0 0 6-6v-4",
    "C20 10 2",
  ],
  appointments: ["M8 2v4M16 2v4M3 10h18M5 6h14v14H5z"],
  psychiatry: ["C12 7 4", "M6 21v-2a4 4 0 0 1 4-4h4a4 4 0 0 1 4 4v2"],
  admission: ["M3 21h18M5 21V7l8-4v18M19 21V11l-6-3", "M9 9h.01M9 13h.01"],
  withdrawal_management: ["M9 3h6M10 3v4l-4 8a4 4 0 0 0 4 6h4a4 4 0 0 0 4-6l-4-8V3"],
  opioid_agonist_therapy: ["M10.5 20.5 3.5 13.5a5 5 0 0 1 7-7l7 7a5 5 0 0 1-7 7Z", "m8.5 8.5 7 7"],
  psychiatric_nursing: ["M3 12h4l2 5 3-11 2 6h5"],
  restrictive_practice: ["R5 11 14 10 2", "M8 11V7a4 4 0 0 1 8 0v4"],
  psychotherapy: ["M21 15a2 2 0 0 1-2 2H8l-4 4V5a2 2 0 0 1 2-2h13a2 2 0 0 1 2 2Z"],
  psychosocial_support: ["C9 8 3", "C17 9 2.5", "M3 20v-1a5 5 0 0 1 10 0v1M14 20v-1a4 4 0 0 1 7-2.6"],
  nutrition_fitness: ["M6 7v10M18 7v10M3 9v6M21 9v6M6 12h12"],
  attachments: [
    "M21.4 11.05 12.25 20.2a5 5 0 0 1-7.07-7.07l9.19-9.19a3 3 0 0 1 4.24 4.24l-8.49 8.49a1 1 0 0 1-1.41-1.41l8.49-8.49",
  ],
  discharge: ["M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4", "M16 17l5-5-5-5M21 12H9"],
  follow_up_aftercare: ["M21 12a9 9 0 1 1-3-6.7", "M21 3v5h-5"],
}));

/** "C cx cy r" → circle, "R x y w h rx" → rect, anything else → path. */
function Shape({ d }: { d: string }) {
  const [kind, ...n] = d.split(" ");
  if (kind === "C") return <circle cx={n[0]} cy={n[1]} r={n[2]} />;
  if (kind === "R") return <rect x={n[0]} y={n[1]} width={n[2]} height={n[3]} rx={n[4]} />;
  return <path d={d} />;
}

export function ModuleGlyph({ code, className = "h-[18px] w-[18px]" }: { code: string; className?: string }) {
  const shapes = PATHS.get(code);
  if (!shapes) return null;
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={className}
    >
      {shapes.map((d) => (
        <Shape key={d} d={d} />
      ))}
    </svg>
  );
}
