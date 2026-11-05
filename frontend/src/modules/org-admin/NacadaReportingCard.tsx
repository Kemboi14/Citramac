import { useEffect, useRef, useState } from "react";
import { FileBarChart } from "lucide-react";
import { useAuth } from "../../auth/useAuth";
import { ApiError } from "../../lib/apiClient";
import { SaveButton } from "../../components/SaveButton";
import { getNacadaSettings, saveNacadaSettings } from "../../lib/mhpExtrasApi";

const FIELD_CLASS =
  "rounded-sm border border-surface-border bg-surface-card px-3 py-2 text-sm text-ink-900 outline-none transition-colors duration-150 focus:border-brand-green";
const LABEL_CLASS = "flex flex-col gap-1.5 text-sm font-medium text-ink-700";
const CARD_CLASS = "rounded-lg border border-surface-border bg-surface-card p-6 shadow-sm";
const SECTION_TITLE_CLASS = "mb-4 font-display text-base font-semibold text-ink-900";

function messageFrom(err: unknown, fallback: string) {
  if (err instanceof ApiError) {
    const field = err.fields?.nacada_report_email;
    if (Array.isArray(field) && field.length) return String(field[0]);
    return err.message;
  }
  return fallback;
}

/**
 * The organisation's NACADA reporting email, where "Send to NACADA" on the
 * NACADA report delivers. Organisation-wide (not per branch); only an Org
 * Admin can change it, and every change is in the audit log.
 */
export function NacadaReportingCard() {
  const { accessToken } = useAuth();
  const [value, setValue] = useState("");
  const [saved, setSaved] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const scrolled = useRef(false);

  // Arriving from the setup checklist (#nacada-reporting): once, after loading.
  useEffect(() => {
    if (saved !== null && !scrolled.current && window.location.hash === "#nacada-reporting") {
      scrolled.current = true;
      cardRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }, [saved]);

  useEffect(() => {
    if (!accessToken) return;
    let cancelled = false;
    getNacadaSettings(accessToken)
      .then((settings) => {
        if (cancelled) return;
        setValue(settings.nacada_report_email);
        setSaved(settings.nacada_report_email);
      })
      .catch((err) => {
        if (!cancelled) setLoadError(messageFrom(err, "Couldn't load the NACADA reporting email."));
      });
    return () => {
      cancelled = true;
    };
  }, [accessToken]);

  const save = async () => {
    if (!accessToken) return;
    setSaveError(null);
    try {
      const next = await saveNacadaSettings(accessToken, value.trim());
      setValue(next.nacada_report_email);
      setSaved(next.nacada_report_email);
    } catch (err) {
      setSaveError(messageFrom(err, "Couldn't save the NACADA reporting email."));
      throw err;
    }
  };

  return (
    <div ref={cardRef} className={`${CARD_CLASS} scroll-mt-24`} id="nacada-reporting">
      <h2 className={SECTION_TITLE_CLASS}>
        <span className="inline-flex items-center gap-2">
          <FileBarChart size={16} className="text-brand-green" />
          NACADA reporting
        </span>
      </h2>
      {loadError ? (
        <p className="rounded-sm bg-status-red-tint px-3 py-2 text-sm text-status-red">
          {loadError}
        </p>
      ) : (
        <form onSubmit={(e) => e.preventDefault()} className="flex flex-col gap-3">
          <p className="text-xs text-ink-500">
            &ldquo;Send to NACADA&rdquo; on the NACADA report emails the report to this address. Use
            the National Drug Observatory reporting address NACADA has given your organisation. It
            applies to every branch. While it is blank the report can&rsquo;t be sent to NACADA.
          </p>
          <label className={LABEL_CLASS}>
            NACADA reporting email
            <input
              type="email"
              className={FIELD_CLASS}
              value={value}
              onChange={(e) => setValue(e.target.value)}
              placeholder="Not set"
              disabled={saved === null}
            />
          </label>
          {saveError && (
            <p className="rounded-sm bg-status-red-tint px-3 py-2 text-sm text-status-red">
              {saveError}
            </p>
          )}
          <div>
            <SaveButton onSave={save} disabled={saved === null || value.trim() === (saved ?? "")}>
              Save NACADA email
            </SaveButton>
          </div>
        </form>
      )}
    </div>
  );
}
