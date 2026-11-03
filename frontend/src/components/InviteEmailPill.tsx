import { StatusPill, type StatusTone } from "../modules/care/shared/ui";
import type { InviteEmail, InviteEmailStatus } from "../lib/governanceApi";

const INVITE_EMAIL: Record<InviteEmailStatus, { tone: StatusTone; label: string; hint: string }> = {
  PENDING: {
    tone: "info",
    label: "Invite email queued",
    hint: "Saved and waiting to be sent. It is retried automatically.",
  },
  SENT: {
    tone: "success",
    label: "Invite email sent",
    hint: "The mail server accepted it. If it hasn't arrived, ask them to check spam, then resend.",
  },
  FAILED: {
    tone: "danger",
    label: "Invite email failed",
    hint: "The mail server refused it after several tries. Check the email address and the organisation's email settings, then resend.",
  },
  NOT_CONFIGURED: {
    tone: "warning",
    label: "Invite email not sent",
    hint: "No mail server is set up, so nothing was sent. Set up email, then resend.",
  },
};

/** What happened to a not-yet-activated person's invite email — read from the
 * outbox, so the roster never says an invite went when it didn't. */
export function InviteEmailPill({ invite }: { invite: InviteEmail | null }) {
  if (!invite) return null;
  const entry = INVITE_EMAIL[invite.status];
  if (!entry) return null;
  return (
    <span title={entry.hint}>
      <StatusPill tone={entry.tone}>{entry.label}</StatusPill>
    </span>
  );
}
