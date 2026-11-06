export type SectionCompletionStatus =
  | "complete"
  | "in_progress"
  | "incomplete"
  | "not_applicable";

const COLOR: Record<SectionCompletionStatus, string> = {
  complete: "#28a745",
  in_progress: "#ffc107",
  incomplete: "#fd7e14",
  not_applicable: "#5f736c",
};

export function SectionCompletionIcon({
  status,
  active = false,
  className = "h-[18px] w-[18px]",
}: {
  status: SectionCompletionStatus;
  active?: boolean;
  className?: string;
}) {
  return (
    <svg
      aria-hidden="true"
      className={className}
      style={{ color: active && status === "in_progress" ? "#007bff" : COLOR[status] }}
      viewBox="0 0 20 20"
      fill="none"
    >
      {status === "in_progress" && (
        <path d="M10 2a8 8 0 0 0 0 16V2Z" fill="currentColor" fillOpacity=".3" />
      )}
      <circle cx="10" cy="10" r="8" stroke="currentColor" strokeWidth="1.7" />
      {status === "in_progress" && (
        <path d="M10 2v16" stroke="currentColor" strokeWidth="1.25" />
      )}
      {status === "not_applicable" && (
        <path d="M6.5 10h7" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      )}
      {status === "complete" && (
        <path
          d="m6 10.2 2.6 2.6L14.5 7"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      )}
    </svg>
  );
}
