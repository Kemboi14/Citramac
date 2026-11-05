import { useState } from "react";
import { useAuth } from "../../../auth/useAuth";
import { ApiError } from "../../../lib/apiClient";
import {
  recordDataSharingConsent,
  type AppointmentChannelConsent,
  type ClientLegal,
} from "../../../lib/carePathwayApi";
import { formatDateTime } from "../shared/format";
import { BTN_GHOST, BTN_SM } from "../shared/styles";
import { Callout, Card, ErrorNote, StatusPill } from "../shared/ui";

const CHANNELS = [
  { key: "sms", type: "APPOINTMENT_SMS", label: "SMS", contact: "contact_phone" },
  { key: "email", type: "APPOINTMENT_EMAIL", label: "Email", contact: "contact_email" },
] as const;

function decisionPill(consent: AppointmentChannelConsent) {
  if (consent.decision === "YES") return <StatusPill tone="success">Agreed</StatusPill>;
  if (consent.decision === "NO") return <StatusPill tone="danger">Declined</StatusPill>;
  return <StatusPill>Not asked</StatusPill>;
}

/**
 * Whether the client agrees to SMS / email about their own appointments
 * (booked, moved, reminder). Nothing is sent on a channel without a recorded
 * Yes. Each answer is kept with the facility's wording version.
 */
export function AppointmentMessagesCard({
  patientId,
  consent,
  onSaved,
}: {
  patientId: string;
  consent: ClientLegal["appointment_messages"];
  onSaved: () => void;
}) {
  const { accessToken } = useAuth();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const template = consent.template;

  const record = async (
    type: "APPOINTMENT_SMS" | "APPOINTMENT_EMAIL",
    label: string,
    granted: boolean,
  ) => {
    if (!accessToken || !template) return;
    const question = granted
      ? `Record that the client AGREED to appointment messages by ${label} (wording version ${template.version})?`
      : `Record that the client DECLINED appointment messages by ${label} (wording version ${template.version})?`;
    if (!window.confirm(question)) return;
    setBusy(true);
    setError(null);
    try {
      await recordDataSharingConsent(accessToken, patientId, granted, type);
      onSaved();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't record the answer.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card title="Appointment messages (SMS / email)">
      <div className="flex flex-col gap-4">
        <p className="text-[13px] text-ink-700">
          Messages say only the facility, date and time — never the type of appointment or the
          service. Nothing is sent on a channel the client hasn&rsquo;t agreed to.
        </p>
        {template ? (
          <div className="rounded-lg border border-surface-border bg-surface-bg p-3.5">
            <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-ink-500">
              Facility wording · version {template.version}
            </div>
            <blockquote className="whitespace-pre-wrap text-[13px] leading-relaxed text-ink-900">
              {template.text}
            </blockquote>
          </div>
        ) : (
          <Callout tone="warning" role="status">
            No wording for appointment messages is set. An Org Admin must publish it first (Org
            Admin → Consent wording → Appointment messages) before the client&rsquo;s answer can be
            recorded.
          </Callout>
        )}
        <ul className="flex flex-col gap-3">
          {CHANNELS.map((c) => {
            const channel = consent[c.key];
            const address = consent[c.contact];
            return (
              <li
                key={c.key}
                className="flex flex-wrap items-center gap-2 border-b border-surface-border pb-3 last:border-b-0"
              >
                <div className="min-w-0 flex-1 text-[13px]">
                  <div className="font-semibold text-ink-900">
                    {c.label}{" "}
                    <span className="font-normal text-ink-500">
                      · {address || `no ${c.key === "sms" ? "phone number" : "email"} on file`}
                    </span>
                  </div>
                  {channel.captured_at && (
                    <div className="text-[11.5px] text-ink-500">
                      {formatDateTime(channel.captured_at)}
                      {channel.captured_by ? ` · ${channel.captured_by}` : ""} · wording version{" "}
                      {channel.consent_text_version}
                    </div>
                  )}
                </div>
                {decisionPill(channel)}
                <button
                  type="button"
                  className={`${BTN_GHOST} ${BTN_SM}`}
                  disabled={!template || busy}
                  onClick={() => void record(c.type, c.label, true)}
                >
                  Agreed
                </button>
                <button
                  type="button"
                  className={`${BTN_GHOST} ${BTN_SM}`}
                  disabled={!template || busy}
                  onClick={() => void record(c.type, c.label, false)}
                >
                  Declined
                </button>
              </li>
            );
          })}
        </ul>
        <ErrorNote>{error}</ErrorNote>
      </div>
    </Card>
  );
}
