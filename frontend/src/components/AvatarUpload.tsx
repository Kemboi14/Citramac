import { useRef, useState } from "react";
import { Camera, Loader2 } from "lucide-react";

/**
 * Circular profile-picture control — shows the current photo (or initials
 * as a fallback), a hover/tap camera affordance, and an inline uploading
 * spinner. Used for every user's own avatar (My Profile, any portal) and
 * for a client's photo (Client Registry registration/profile) — the "every
 * user, even the client, must be able to add a profile picture" feature.
 */
export function AvatarUpload({
  imageUrl,
  initials,
  size = 88,
  onUpload,
  disabled = false,
}: {
  imageUrl: string | null | undefined;
  initials: string;
  size?: number;
  onUpload: (file: File) => Promise<void>;
  disabled?: boolean;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [preview, setPreview] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleFile = async (file: File | undefined) => {
    if (!file) return;
    setError(null);
    const objectUrl = URL.createObjectURL(file);
    setPreview(objectUrl);
    setUploading(true);
    try {
      await onUpload(file);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed.");
      setPreview(null);
    } finally {
      setUploading(false);
      URL.revokeObjectURL(objectUrl);
    }
  };

  const src = preview ?? imageUrl ?? null;

  return (
    <div className="flex flex-col items-center gap-2">
      <button
        type="button"
        disabled={disabled || uploading}
        onClick={() => inputRef.current?.click()}
        style={{ width: size, height: size }}
        className="group relative flex flex-shrink-0 items-center justify-center overflow-hidden rounded-full border-2 border-white bg-brand-green text-white shadow-sm ring-1 ring-surface-border transition-transform duration-150 hover:scale-[1.03] disabled:cursor-not-allowed disabled:opacity-70"
        aria-label="Change profile picture"
      >
        {src ? (
          <img src={src} alt="" className="h-full w-full object-cover" />
        ) : (
          <span className="font-display font-bold" style={{ fontSize: size * 0.32 }}>
            {initials}
          </span>
        )}
        <span className="absolute inset-0 flex items-center justify-center bg-black/0 opacity-0 transition-all duration-150 group-hover:bg-black/40 group-hover:opacity-100">
          {uploading ? (
            <Loader2 className="h-5 w-5 animate-spin text-white" />
          ) : (
            <Camera className="h-5 w-5 text-white" />
          )}
        </span>
      </button>
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        hidden
        onChange={(event) => handleFile(event.target.files?.[0])}
      />
      {error && <p className="max-w-[160px] text-center text-[11px] text-status-red">{error}</p>}
    </div>
  );
}
