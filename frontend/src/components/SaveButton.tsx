import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { Check, Loader2 } from "lucide-react";

type Status = "idle" | "loading" | "success" | "error";

/**
 * A "Save changes"-style button that animates through its own async
 * lifecycle — spinner while `onSave` is in flight, a brief checkmark pulse
 * on success, a shake on failure — instead of just going quiet and leaving
 * the user unsure whether the click registered. Used for every save/submit
 * action across all three portals (Super Admin, Org Admin, Clinical
 * Workspace), not just the Clinical Workspace forms this was built for.
 *
 * `onSave` does the actual work (an API call) and should throw/reject on
 * failure — this component only owns the button's visual state, callers
 * still own their own success/error messaging (toasts, inline errors, etc).
 */
export function SaveButton({
  onSave,
  children = "Save changes",
  savingLabel = "Saving…",
  savedLabel = "Saved",
  variant = "primary",
  className = "",
  disabled = false,
  type = "button",
}: {
  onSave: () => Promise<void>;
  children?: ReactNode;
  savingLabel?: ReactNode;
  savedLabel?: ReactNode;
  variant?: "primary" | "ghost";
  className?: string;
  disabled?: boolean;
  type?: "button" | "submit";
}) {
  const [status, setStatus] = useState<Status>("idle");
  const mountedRef = useRef(true);
  useEffect(
    () => () => {
      mountedRef.current = false;
    },
    [],
  );

  const handleClick = async () => {
    if (status === "loading") return;
    setStatus("loading");
    try {
      await onSave();
      if (!mountedRef.current) return;
      setStatus("success");
      window.setTimeout(() => {
        if (mountedRef.current) setStatus("idle");
      }, 1400);
    } catch (error) {
      if (!mountedRef.current) return;
      setStatus("error");
      window.setTimeout(() => {
        if (mountedRef.current) setStatus("idle");
      }, 900);
      throw error;
    }
  };

  const base =
    "relative inline-flex min-w-[9.5rem] items-center justify-center gap-2 overflow-hidden rounded-[10px] px-4 py-2.5 text-[13px] font-semibold transition-all duration-200 disabled:cursor-not-allowed disabled:opacity-60";
  const variants = {
    primary: "bg-brand-green text-white shadow-sm hover:bg-brand-green-dark",
    ghost: "border border-surface-border bg-white text-ink-700 hover:bg-surface-bg",
  } as const;
  const shake = status === "error" ? "animate-shake" : "";

  return (
    <button
      type={type}
      onClick={type === "button" ? handleClick : undefined}
      disabled={disabled || status === "loading"}
      // eslint-disable-next-line security/detect-object-injection -- `variant` is a compile-time-checked prop union, never user input.
      className={`${base} ${variants[variant]} ${shake} ${className}`}
    >
      <span
        className={`flex items-center gap-2 transition-all duration-200 ${
          status === "idle" || status === "error" ? "opacity-100" : "opacity-0"
        } ${status === "loading" || status === "success" ? "absolute" : ""}`}
      >
        {children}
      </span>
      <span
        className={`flex items-center gap-2 transition-all duration-200 ${
          status === "loading" ? "opacity-100" : "pointer-events-none absolute opacity-0"
        }`}
      >
        <Loader2 className="h-4 w-4 animate-spin" />
        {savingLabel}
      </span>
      <span
        className={`flex items-center gap-2 transition-all duration-200 ${
          status === "success"
            ? "scale-100 opacity-100"
            : "pointer-events-none absolute scale-75 opacity-0"
        }`}
      >
        <Check className="h-4 w-4" />
        {savedLabel}
      </span>
    </button>
  );
}
