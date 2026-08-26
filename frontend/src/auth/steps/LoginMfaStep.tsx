import { useEffect, useRef, useState } from "react";
import type { MfaChannel, MfaDeliveryMethod } from "../../lib/authApi";
import { resendOtp as resendOtpApi } from "../../lib/authApi";
import { ApiError } from "../../lib/apiClient";
import { AuthButton, SecureFooter } from "./AuthCard";

const RESEND_COOLDOWN_SECONDS = 45;

const CHANNEL_LABEL: Record<MfaChannel, string> = { SMS: "SMS", EMAIL: "Email" };

function describeChannel(method: MfaDeliveryMethod) {
  return method.channel === "SMS"
    ? `Enter the 6-digit code sent to your mobile number ending in ${method.masked_contact.slice(-4)}.`
    : `Enter the 6-digit code sent to your email address ending in ${method.masked_contact.split("@")[1] ?? ""}.`;
}

/**
 * Login 2FA (citramac-mfa.html) — lets the user pick SMS or Email when both
 * are on file, shows the masked destination, and verifies via the same
 * /auth/login/verify-otp/ endpoint the plain login flow uses. Kept separate
 * from the shared <OtpStep> (used by activation/reset) since those flows
 * have no channel choice or masked-contact concept — folding this in would
 * have made OtpStep's props conditional on a flow it doesn't otherwise know
 * about.
 */
export function LoginMfaStep({
  otpToken: initialOtpToken,
  channel: initialChannel,
  deliveryMethods,
  verify,
  onSuccess,
}: {
  otpToken: string;
  channel: MfaChannel;
  deliveryMethods: MfaDeliveryMethod[];
  verify: (otpToken: string, otp: string) => Promise<void>;
  onSuccess: () => void;
}) {
  const [otpToken, setOtpToken] = useState(initialOtpToken);
  const [activeChannel, setActiveChannel] = useState<MfaChannel>(initialChannel);
  const [digits, setDigits] = useState<string[]>(Array(6).fill(""));
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSwitching, setIsSwitching] = useState(false);
  const [cooldown, setCooldown] = useState(RESEND_COOLDOWN_SECONDS);
  const inputsRef = useRef<(HTMLInputElement | null)[]>([]);

  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = setInterval(() => setCooldown((s) => Math.max(0, s - 1)), 1000);
    return () => clearInterval(timer);
  }, [cooldown]);

  const activeMethod =
    deliveryMethods.find((m) => m.channel === activeChannel) ?? deliveryMethods[0];
  const otp = digits.join("");

  const setDigit = (index: number, value: string) => {
    const clean = value.replace(/\D/g, "").slice(-1);
    setDigits((prev) => {
      const next = [...prev];
      // index is a fixed 0-5 OTP box position, never user-controlled input.
      // eslint-disable-next-line security/detect-object-injection
      next[index] = clean;
      return next;
    });
    if (clean && index < 5) inputsRef.current[index + 1]?.focus();
    setError(null);
  };

  const handleKeyDown = (index: number, event: React.KeyboardEvent<HTMLInputElement>) => {
    // eslint-disable-next-line security/detect-object-injection
    if (event.key === "Backspace" && !digits[index] && index > 0) {
      inputsRef.current[index - 1]?.focus();
    }
  };

  const handlePaste = (event: React.ClipboardEvent<HTMLInputElement>) => {
    event.preventDefault();
    const pasted = event.clipboardData.getData("text").replace(/\D/g, "").slice(0, 6);
    if (!pasted) return;
    setDigits((prev) => {
      const next = [...prev];
      // eslint-disable-next-line security/detect-object-injection
      pasted.split("").forEach((digit, i) => (next[i] = digit));
      return next;
    });
    inputsRef.current[Math.min(pasted.length, 6) - 1]?.focus();
  };

  const handleSwitchChannel = async (nextChannel: MfaChannel) => {
    if (nextChannel === activeChannel || isSwitching || cooldown > 0) return;
    setIsSwitching(true);
    setError(null);
    try {
      const result = await resendOtpApi(otpToken, nextChannel);
      setOtpToken(result.otp_token);
      setActiveChannel(result.channel ?? nextChannel);
      setDigits(Array(6).fill(""));
      setCooldown(RESEND_COOLDOWN_SECONDS);
      inputsRef.current[0]?.focus();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't send a code to that channel.");
    } finally {
      setIsSwitching(false);
    }
  };

  const handleResend = async () => {
    if (cooldown > 0) return;
    setError(null);
    try {
      const result = await resendOtpApi(otpToken, activeChannel);
      setOtpToken(result.otp_token);
      setDigits(Array(6).fill(""));
      setCooldown(RESEND_COOLDOWN_SECONDS);
      inputsRef.current[0]?.focus();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't resend the code.");
    }
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (otp.length !== 6) {
      setError("Enter all 6 digits to continue.");
      return;
    }
    setError(null);
    setIsSubmitting(true);
    try {
      await verify(otpToken, otp);
      onSuccess();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Something went wrong.");
    } finally {
      setIsSubmitting(false);
    }
  };

  const mm = String(Math.floor(cooldown / 60)).padStart(2, "0");
  const ss = String(cooldown % 60).padStart(2, "0");

  return (
    <div className="flex min-h-screen items-center justify-center bg-surface-bg px-4 py-8">
      <div className="w-full max-w-[475px] overflow-hidden rounded-lg border border-surface-border bg-surface-card px-11 pb-7 pt-10 shadow-md">
        <h1 className="text-center font-display text-2xl font-semibold text-ink-900">
          Verify Your Identity
        </h1>
        <p className="mx-auto mt-3 max-w-[340px] text-center text-[13px] leading-relaxed text-ink-500">
          {activeMethod ? describeChannel(activeMethod) : "Enter the 6-digit code we sent you."}
        </p>

        {deliveryMethods.length > 1 && (
          <fieldset className="mb-[22px] mt-2 grid gap-[9px]">
            <legend className="mb-2.5 text-xs font-semibold text-ink-700">
              How would you like to receive your verification code?
            </legend>
            {deliveryMethods.map((method) => (
              <label
                key={method.channel}
                className={`flex items-center gap-[11px] rounded-md border px-3.5 py-3 text-xs ${
                  method.channel === activeChannel
                    ? "border-brand-green bg-brand-green-tint-2 shadow-[0_0_0_2px_rgba(0,110,81,0.08)]"
                    : "border-surface-border"
                }`}
              >
                <input
                  type="radio"
                  name="delivery"
                  checked={method.channel === activeChannel}
                  disabled={isSwitching || cooldown > 0}
                  onChange={() => handleSwitchChannel(method.channel)}
                  className="h-4 w-4 accent-brand-green"
                />
                <span>
                  <strong className="mb-0.5 block text-xs">{CHANNEL_LABEL[method.channel]}</strong>
                  <span className="text-[11px] text-ink-500">{method.masked_contact}</span>
                </span>
              </label>
            ))}
          </fieldset>
        )}

        <form onSubmit={handleSubmit}>
          <label className="mb-2.5 block text-xs font-semibold text-ink-700">
            Enter verification code
          </label>
          <div
            role="group"
            aria-label="Six-digit verification code"
            className="flex justify-center gap-2.5"
          >
            {digits.map((digit, index) => (
              <input
                key={index}
                ref={(el) => {
                  // eslint-disable-next-line security/detect-object-injection
                  inputsRef.current[index] = el;
                }}
                value={digit}
                onChange={(e) => setDigit(index, e.target.value)}
                onKeyDown={(e) => handleKeyDown(index, e)}
                onPaste={handlePaste}
                inputMode="numeric"
                maxLength={1}
                autoFocus={index === 0}
                aria-label={`Digit ${index + 1}`}
                className="h-[53px] w-[49px] rounded-lg border border-surface-border text-center text-xl font-semibold text-ink-900 outline-none focus:border-brand-green focus:ring-4 focus:ring-brand-green/10"
              />
            ))}
          </div>
          <p role="alert" className="mt-2 min-h-[18px] text-center text-[11px] text-status-red">
            {error}
          </p>
          <p className="mb-[22px] mt-1 text-center text-xs text-ink-500">
            Didn&rsquo;t receive a code?{" "}
            <button
              type="button"
              onClick={handleResend}
              disabled={cooldown > 0}
              className="font-semibold text-brand-green-dark underline decoration-1 disabled:text-ink-400 disabled:no-underline"
            >
              {cooldown > 0 ? `Resend in ${mm}:${ss}` : "Resend code"}
            </button>
          </p>
          <AuthButton disabled={isSubmitting || otp.length !== 6}>
            {isSubmitting ? "Verifying..." : "Verify"}
          </AuthButton>
        </form>

        <SecureFooter label="Your data is secure and encrypted" edgeClassName="-mx-11 -mb-7" />
      </div>
    </div>
  );
}
