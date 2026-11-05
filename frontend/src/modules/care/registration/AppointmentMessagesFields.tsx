import { useEffect, useState } from "react";
import { useAuth } from "../../../auth/useAuth";
import { listConsentTemplates, type ConsentTemplate } from "../../../lib/carePathwayApi";
import { Callout } from "../shared/ui";

export type AppointmentDecision = "NOT_ASKED" | "YES" | "NO";
export interface AppointmentMessagesForm {
  sms: AppointmentDecision;
  email: AppointmentDecision;
}
export const EMPTY_APPOINTMENT_MESSAGES: AppointmentMessagesForm = {
  sms: "NOT_ASKED",
  email: "NOT_ASKED",
};

/** What registration sends: only the channels actually asked about. */
export function appointmentMessagesPayload(form: AppointmentMessagesForm) {
  const asked = form.sms !== "NOT_ASKED" || form.email !== "NOT_ASKED";
  return asked ? form : undefined;
}

const OPTIONS: { value: AppointmentDecision; label: string }[] = [
  { value: "NOT_ASKED", label: "Not asked" },
  { value: "YES", label: "Yes" },
  { value: "NO", label: "No" },
];

/**
 * Registration: does the client agree to SMS / email about their appointments?
 * Shows the facility's own wording (set by the Org Admin); the server records
 * the answer against that wording. Without wording the question can't be asked.
 */
export function AppointmentMessagesFields({
  value,
  onChange,
}: {
  value: AppointmentMessagesForm;
  onChange: (next: AppointmentMessagesForm) => void;
}) {
  const { accessToken } = useAuth();
  const [template, setTemplate] = useState<ConsentTemplate | null | undefined>(undefined);

  useEffect(() => {
    if (!accessToken) return;
    let cancelled = false;
    listConsentTemplates(accessToken)
      .then((r) => {
        if (cancelled) return;
        setTemplate(
          r.results.find((t) => t.consent_type === "APPOINTMENT_MESSAGES" && t.active) ?? null,
        );
      })
      .catch(() => !cancelled && setTemplate(null));
    return () => {
      cancelled = true;
    };
  }, [accessToken]);

  return (
    <fieldset className="mt-4 min-w-0">
      <legend className="text-base font-semibold text-ink-900">Appointment messages</legend>
      <p className="mt-1 text-[13px] text-ink-500">
        SMS / email about the client&rsquo;s own appointments — booked, moved and a reminder.
        Messages give only the facility, date and time.
      </p>
      {template === undefined ? null : template === null ? (
        <Callout tone="warning" role="status" className="mt-3">
          Your Org Admin hasn&rsquo;t set the wording for appointment messages (Consent wording), so
          this can&rsquo;t be asked yet. No messages are sent until it is.
        </Callout>
      ) : (
        <div className="mt-3 overflow-hidden rounded-[14px] border border-surface-border">
          <blockquote className="whitespace-pre-wrap border-b border-surface-border bg-surface-bg px-[18px] py-3 text-[13px] leading-relaxed text-ink-900">
            {template.text}
            <span className="mt-1 block text-[11px] text-ink-500">
              Facility wording · version {template.version}
            </span>
          </blockquote>
          <div className="grid min-[701px]:grid-cols-2">
            {(["sms", "email"] as const).map((channel, index) => (
              <div
                key={channel}
                role="radiogroup"
                aria-labelledby={`reg-appt-${channel}`}
                className={`flex flex-col gap-3 px-[18px] py-4 ${
                  index === 0
                    ? "border-b border-surface-border min-[701px]:border-b-0 min-[701px]:border-r"
                    : ""
                }`}
              >
                <h4 id={`reg-appt-${channel}`} className="text-[14px] font-semibold text-ink-900">
                  {channel === "sms" ? "By SMS" : "By email"}
                </h4>
                <div className="flex overflow-hidden rounded-[10px] border border-surface-border">
                  {OPTIONS.map((o) => {
                    // eslint-disable-next-line security/detect-object-injection -- `channel` is a fixed union.
                    const checked = value[channel] === o.value;
                    return (
                      <label
                        key={o.value}
                        className="relative flex-1 cursor-pointer border-r border-surface-border last:border-r-0"
                      >
                        <input
                          type="radio"
                          name={`reg-appt-${channel}`}
                          value={o.value}
                          checked={checked}
                          onChange={() => onChange({ ...value, [channel]: o.value })}
                          className="peer absolute inset-0 cursor-pointer opacity-0"
                        />
                        <span
                          className={`block px-1.5 py-[9px] text-center text-[13px] font-medium peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:-outline-offset-2 peer-focus-visible:outline-brand-green ${
                            checked
                              ? "bg-brand-green text-on-primary"
                              : "text-ink-500 hover:bg-surface-bg"
                          }`}
                        >
                          {o.label}
                        </span>
                      </label>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </fieldset>
  );
}
