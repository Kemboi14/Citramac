import { useEffect, useState } from "react";
import { useAuth } from "../../../../auth/useAuth";
import { getSbar } from "../../../../lib/carePathwayApi";
import { BTN_GHOST, BTN_SM } from "../../shared/styles";
import { ErrorNote } from "../../shared/ui";
import { errorText } from "../../triage/helpers";

/** SBAR handover — built from the record, nothing retyped. */
export function SbarModule({ patientId }: { patientId: string }) {
  const { accessToken } = useAuth();
  const [text, setText] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!accessToken) return;
    getSbar(accessToken, patientId).then((r) => setText(r.text)).catch((e) => setError(errorText(e, "Couldn't build the SBAR.")));
  }, [accessToken, patientId]);
  return (
    <div className="flex flex-col gap-2">
      <ErrorNote>{error}</ErrorNote>
      <pre className="whitespace-pre-wrap rounded-lg border border-surface-border bg-surface-bg p-3 text-[12.5px] leading-relaxed">{text ?? "Building…"}</pre>
      <div>
        <button type="button" className={`${BTN_GHOST} ${BTN_SM}`} disabled={!text} onClick={() => text && void navigator.clipboard.writeText(text).then(() => setCopied(true))}>
          {copied ? "Copied" : "Copy SBAR"}
        </button>
      </div>
    </div>
  );
}
