import { useRef, useState } from "react";
import { useAuth } from "../../../../auth/useAuth";
import {
  downloadLegalDocumentCopy,
  removeLegalDocumentCopy,
  uploadLegalDocumentCopy,
  type LegalDocumentRow,
} from "../../../../lib/legalStatusApi";
import { formatDateTime } from "../../shared/format";
import { BTN, BTN_GHOST, BTN_SM, INPUT } from "../../shared/styles";
import { ErrorNote } from "../../shared/ui";
import { errorText } from "../../triage/helpers";

type Runner = (fn: (token: string) => Promise<unknown>, fallback: string) => Promise<boolean>;

const ACCEPT = ".pdf,.png,.jpg,.jpeg,application/pdf,image/png,image/jpeg";

/** Scanned, hand-signed copies of one statutory form: upload beside the form,
 * open, or take a wrong upload off. Evidence only — a copy never signs the
 * form or changes its status. */
export function SignedCopies({
  doc,
  busy,
  run,
}: {
  doc: LegalDocumentRow;
  busy: boolean;
  run: Runner;
}) {
  const { accessToken, claims } = useAuth();
  const input = useRef<HTMLInputElement>(null);
  const [removing, setRemoving] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);

  const open = async (copyId: string) => {
    if (!accessToken) return;
    setError(null);
    try {
      const blob = await downloadLegalDocumentCopy(accessToken, doc.id, copyId);
      const url = URL.createObjectURL(blob);
      window.open(url, "_blank", "noopener");
      window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (err) {
      setError(errorText(err, "Couldn't open the copy."));
    }
  };

  const upload = async (file: File | undefined) => {
    if (!file) return;
    await run((t) => uploadLegalDocumentCopy(t, doc.id, file), "Couldn't upload the copy.");
    if (input.current) input.current.value = "";
  };

  return (
    <div className="ml-1 flex flex-col gap-1.5 border-l-2 border-surface-border pl-3">
      {doc.copies.map((c) => (
        <div key={c.id} className="flex flex-col gap-1">
          <div className="flex flex-wrap items-center gap-2 text-[12.5px]">
            <span className="text-ink-500">Signed copy:</span>
            <button
              type="button"
              className="font-semibold text-brand-green underline-offset-2 hover:underline"
              onClick={() => void open(c.id)}
            >
              {c.name}
            </button>
            <span className="text-[11.5px] text-ink-500">
              {[c.uploaded_by, formatDateTime(c.uploaded_at)].filter(Boolean).join(" · ")}
            </span>
            {c.uploaded_by_id === claims?.user_id && (
              <button
                type="button"
                className={`${BTN_GHOST} ${BTN_SM}`}
                onClick={() => {
                  setRemoving(removing === c.id ? null : c.id);
                  setReason("");
                }}
              >
                Remove
              </button>
            )}
          </div>
          {removing === c.id && (
            <div className="flex flex-wrap gap-2">
              <input
                className={INPUT}
                placeholder="Why is this copy being removed?"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
              />
              <button
                type="button"
                className={`${BTN} ${BTN_SM}`}
                disabled={busy || reason.trim().length < 5}
                onClick={async () => {
                  if (
                    await run(
                      (t) => removeLegalDocumentCopy(t, doc.id, c.id, reason),
                      "Couldn't remove the copy.",
                    )
                  ) {
                    setRemoving(null);
                    setReason("");
                  }
                }}
              >
                Remove copy
              </button>
            </div>
          )}
        </div>
      ))}
      <div className="flex flex-wrap items-center gap-2">
        <input
          ref={input}
          type="file"
          accept={ACCEPT}
          className="hidden"
          aria-label={`Upload a signed copy of ${doc.title}`}
          onChange={(e) => void upload(e.target.files?.[0])}
        />
        <button
          type="button"
          className={`${BTN_GHOST} ${BTN_SM}`}
          disabled={busy}
          onClick={() => input.current?.click()}
        >
          Upload signed copy
        </button>
        <span className="text-[11.5px] text-ink-500">
          PDF, PNG or JPEG, up to 10 MB. Kept as evidence beside the form; it does not sign it.
        </span>
      </div>
      <ErrorNote>{error}</ErrorNote>
    </div>
  );
}
