import { useState } from "react";
import { Download } from "lucide-react";
import { useAuth } from "../auth/useAuth";
import { ApiError, apiDownload } from "../lib/apiClient";

/** Downloads an API-served file with the user's token and saves it — for
 * files that must never be public (e.g. ODPC registration evidence). */
export function AuthenticatedDownloadButton({
  path,
  filename,
  children,
  className = "inline-flex items-center gap-1 text-xs font-semibold text-brand-green hover:underline disabled:opacity-60",
}: {
  path: string;
  filename: string;
  children: React.ReactNode;
  className?: string;
}) {
  const { accessToken } = useAuth();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const download = async () => {
    if (!accessToken) return;
    setBusy(true);
    setError(null);
    try {
      const blob = await apiDownload(path, accessToken);
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = filename;
      link.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "The file could not be downloaded.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <span className="inline-flex flex-col">
      <button type="button" onClick={download} disabled={busy} className={className}>
        {children} <Download className="h-3 w-3" />
      </button>
      {error && <span className="text-xs text-status-red">{error}</span>}
    </span>
  );
}
