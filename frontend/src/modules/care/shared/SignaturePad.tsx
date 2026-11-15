import { useEffect, useRef, useState } from "react";
import type { SignatureInput } from "../../../lib/carePathwayApi";
import { BTN_GHOST, BTN_SM, INPUT } from "./styles";

/**
 * An on-screen signature (owner decisions 2026-11-13): drawn with a finger,
 * stylus or mouse, witnessed by the staff member present. The drawing is sent as
 * a PNG and held only in memory here — never in browser storage (guide.md §5).
 *
 * To clear it (e.g. after the consent is saved), remount it with a new `key`.
 * `allowUnable` offers "Unable to sign" with a reason instead of a drawing, for
 * a party who cannot sign; the staff witness always draws.
 */
export function SignaturePad({
  label,
  allowUnable = false,
  onChange,
}: {
  label: string;
  allowUnable?: boolean;
  onChange: (value: SignatureInput | null) => void;
}) {
  const canvas = useRef<HTMLCanvasElement | null>(null);
  const drawing = useRef(false);
  const last = useRef<{ x: number; y: number } | null>(null);
  const ink = useRef(false);
  const [hasInk, setHasInk] = useState(false);
  const [unable, setUnable] = useState(false);
  const [reason, setReason] = useState("");

  const clear = () => {
    const c = canvas.current;
    const ctx = c?.getContext("2d");
    if (c && ctx) ctx.clearRect(0, 0, c.width, c.height);
    ink.current = false;
    setHasInk(false);
    onChange(null);
  };

  useEffect(() => {
    // Size the backing store to the device's pixels so strokes stay sharp.
    const c = canvas.current;
    if (!c) return;
    const ratio = window.devicePixelRatio || 1;
    const rect = c.getBoundingClientRect();
    c.width = Math.max(1, Math.round(rect.width * ratio));
    c.height = Math.max(1, Math.round(rect.height * ratio));
    const ctx = c.getContext("2d");
    if (ctx) {
      ctx.scale(ratio, ratio);
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.lineWidth = 2.2;
      ctx.strokeStyle = "#111";
    }
    // The canvas is re-created when "Unable to sign" is unticked.
  }, [unable]);

  const point = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  };

  const down = (e: React.PointerEvent<HTMLCanvasElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    drawing.current = true;
    last.current = point(e);
  };
  const move = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!drawing.current || !last.current) return;
    const ctx = e.currentTarget.getContext("2d");
    if (!ctx) return;
    const p = point(e);
    ctx.beginPath();
    ctx.moveTo(last.current.x, last.current.y);
    ctx.lineTo(p.x, p.y);
    ctx.stroke();
    last.current = p;
    if (!ink.current) {
      ink.current = true;
      setHasInk(true);
    }
  };
  const up = () => {
    if (!drawing.current) return;
    drawing.current = false;
    last.current = null;
    if (canvas.current && ink.current) onChange({ image: canvas.current.toDataURL("image/png") });
  };

  const chooseUnable = (value: boolean) => {
    setUnable(value);
    setReason("");
    if (value) {
      clear();
      onChange(null);
    }
  };

  return (
    <fieldset className="flex min-w-[260px] flex-1 flex-col gap-1.5 rounded-lg border border-surface-border p-2.5">
      <legend className="px-1 text-xs font-semibold text-ink-900">{label}</legend>
      {!unable && (
        <>
          <canvas
            ref={canvas}
            aria-label={`${label} — draw the signature`}
            role="img"
            className="h-[110px] w-full touch-none rounded-md border border-dashed border-surface-border bg-white"
            onPointerDown={down}
            onPointerMove={move}
            onPointerUp={up}
            onPointerCancel={up}
            onPointerLeave={up}
          />
          <div className="flex items-center justify-between text-[12px] text-ink-500">
            <span>{hasInk ? "Signed" : "Sign inside the box"}</span>
            <button type="button" className={`${BTN_GHOST} ${BTN_SM}`} onClick={clear}>
              Clear
            </button>
          </div>
        </>
      )}
      {allowUnable && (
        <label className="flex items-center gap-2 text-[12px]">
          <input
            type="checkbox"
            checked={unable}
            onChange={(e) => chooseUnable(e.target.checked)}
          />
          Unable to sign
        </label>
      )}
      {unable && (
        <input
          className={INPUT}
          placeholder="Why they cannot sign (e.g. injured hand — consent given verbally)"
          value={reason}
          onChange={(e) => {
            setReason(e.target.value);
            onChange(e.target.value.trim().length >= 5 ? { unable_reason: e.target.value } : null);
          }}
        />
      )}
    </fieldset>
  );
}
