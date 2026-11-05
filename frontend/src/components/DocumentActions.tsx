import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Download, Eye, Printer, X } from "lucide-react";
import { useAuth } from "../auth/useAuth";
import { ApiError, apiDownload } from "../lib/apiClient";
import { useDialogA11y } from "./useDialogA11y";

const BUTTON =
  "inline-flex items-center gap-1.5 rounded-md border border-surface-border bg-surface-card px-3 py-1.5 text-[12.5px] font-semibold text-ink-900 hover:bg-surface-bg disabled:cursor-not-allowed disabled:opacity-60";
const PRIMARY =
  "inline-flex items-center gap-1.5 rounded-md border border-brand-green bg-brand-green px-3 py-1.5 text-[12.5px] font-semibold text-on-primary hover:bg-brand-green-dark disabled:cursor-not-allowed disabled:opacity-60";

function withOutput(path: string, output: "pdf") {
  return `${path}${path.includes("?") ? "&" : "?"}output=${output}`;
}

function message(err: unknown, fallback: string) {
  return err instanceof ApiError ? err.message : fallback;
}

/**
 * Preview and Download for any server-rendered document (the shared
 * professional layout, apps/documents/printing.py). `path` is the API path of
 * the document's print endpoint: it returns the HTML preview, and with
 * `?output=pdf` the PDF. Preview opens the document in a dialog, where it can
 * also be printed or downloaded.
 */
export function DocumentActions({
  path,
  filename,
  label,
  disabled = false,
  onDownloaded,
}: {
  path: string;
  /** Download name without extension, e.g. "DOC-WRK-01-ABC-v1". */
  filename: string;
  /** What the document is, for the dialog title and screen readers. */
  label: string;
  disabled?: boolean;
  /** Called after the PDF downloaded — e.g. to refresh a record the download changed. */
  onDownloaded?: () => void;
}) {
  const { accessToken } = useAuth();
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState<"preview" | "pdf" | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(
    () => () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    },
    [previewUrl],
  );

  const preview = async () => {
    if (!accessToken) return;
    setBusy("preview");
    setError(null);
    try {
      const blob = await apiDownload(path, accessToken);
      setPreviewUrl(URL.createObjectURL(new Blob([blob], { type: "text/html" })));
    } catch (err) {
      setError(message(err, "Couldn't open the preview."));
    } finally {
      setBusy(null);
    }
  };

  const download = async () => {
    if (!accessToken) return;
    setBusy("pdf");
    setError(null);
    try {
      const blob = await apiDownload(withOutput(path, "pdf"), accessToken);
      const url = URL.createObjectURL(new Blob([blob], { type: "application/pdf" }));
      const link = document.createElement("a");
      link.href = url;
      link.download = `${filename}.pdf`;
      link.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      onDownloaded?.();
    } catch (err) {
      setError(message(err, "Couldn't download the PDF."));
    } finally {
      setBusy(null);
    }
  };

  return (
    <span className="inline-flex flex-col gap-1">
      <span className="inline-flex flex-wrap gap-2">
        <button
          type="button"
          className={BUTTON}
          onClick={() => void preview()}
          disabled={disabled || busy !== null}
          aria-label={`Preview ${label}`}
        >
          <Eye size={14} aria-hidden="true" />
          {busy === "preview" ? "Opening…" : "Preview"}
        </button>
        <button
          type="button"
          className={PRIMARY}
          onClick={() => void download()}
          disabled={disabled || busy !== null}
          aria-label={`Download ${label} as PDF`}
        >
          <Download size={14} aria-hidden="true" />
          {busy === "pdf" ? "Preparing PDF…" : "Download PDF"}
        </button>
      </span>
      {error && (
        <span role="alert" className="text-[12px] text-status-red">
          {error}
        </span>
      )}
      {previewUrl && (
        <PreviewDialog
          url={previewUrl}
          label={label}
          downloading={busy === "pdf"}
          onDownload={() => void download()}
          onClose={() => setPreviewUrl(null)}
        />
      )}
    </span>
  );
}

function PreviewDialog({
  url,
  label,
  downloading,
  onDownload,
  onClose,
}: {
  url: string;
  label: string;
  downloading: boolean;
  onDownload: () => void;
  onClose: () => void;
}) {
  const ref = useDialogA11y<HTMLDivElement>(true, onClose);
  const frame = useRef<HTMLIFrameElement>(null);
  return createPortal(
    <div className="fixed inset-0 z-[95] flex flex-col bg-surface-scrim p-2 sm:p-6">
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-label={`Preview: ${label}`}
        className="mx-auto flex h-full w-full max-w-[980px] flex-col overflow-hidden rounded-lg bg-surface-card shadow-md"
      >
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-surface-border px-4 py-2.5">
          <div className="min-w-0 truncate text-[13.5px] font-bold text-ink-900">{label}</div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className={BUTTON}
              onClick={() => frame.current?.contentWindow?.print()}
            >
              <Printer size={14} aria-hidden="true" /> Print
            </button>
            <button type="button" className={PRIMARY} onClick={onDownload} disabled={downloading}>
              <Download size={14} aria-hidden="true" />
              {downloading ? "Preparing PDF…" : "Download PDF"}
            </button>
            <button type="button" className={BUTTON} onClick={onClose} aria-label="Close preview">
              <X size={14} aria-hidden="true" /> Close
            </button>
          </div>
        </div>
        <iframe
          ref={frame}
          title={`Preview: ${label}`}
          src={url}
          // The document is server-rendered and escaped; no script runs in it.
          sandbox="allow-same-origin allow-modals"
          className="h-full w-full flex-1 border-0 bg-[#e6e6e6]"
        />
      </div>
    </div>,
    document.body,
  );
}
