import type { AppointmentMessage } from "../../../lib/carePathwayApi";
import { StatusPill, type StatusTone } from "./ui";

const TONE: Record<AppointmentMessage["status"], StatusTone> = {
  SENT: "success",
  PENDING: "info",
  FAILED: "danger",
  NOT_CONFIGURED: "warning",
};
const STATUS: Record<AppointmentMessage["status"], string> = {
  SENT: "sent",
  PENDING: "sending",
  FAILED: "failed",
  NOT_CONFIGURED: "not set up",
};

/**
 * What was sent to the client about an appointment, one pill per message
 * ("Reminder SMS · sent"). "No messages" when none went — usually because the
 * client hasn't agreed to SMS / email about appointments.
 */
export function AppointmentMessages({ messages }: { messages: AppointmentMessage[] }) {
  if (messages.length === 0) {
    return <span className="text-[11.5px] text-ink-500">No messages</span>;
  }
  return (
    <span className="inline-flex flex-wrap gap-1">
      {messages.map((m, i) => (
        <StatusPill key={`${m.kind}-${m.channel}-${i}`} tone={TONE[m.status]}>
          {m.label} {m.channel === "SMS" ? "SMS" : "email"} · {STATUS[m.status]}
        </StatusPill>
      ))}
    </span>
  );
}
