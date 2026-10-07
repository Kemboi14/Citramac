import { useEffect, useState, type FormEvent } from "react";
import { useAuth } from "../../auth/useAuth";
import { ApiError } from "../../lib/apiClient";
import {
  createConsentTemplate,
  listConsentTemplates,
  type ConsentTemplate,
} from "../../lib/carePathwayApi";

// Org Admin — the facility's data-sharing (HIE) consent wording. The legal
// text is set by the facility and never written or suggested by the system
// (CLAUDE.md §6). Every consent record keeps the version the client was shown,
// so wording is never edited in place: saving creates a new version and the
// server retires the previous one.

const CARD_CLASS = "rounded-lg border border-surface-border bg-surface-card shadow-sm";
const CARD_HEADER =
  "flex flex-wrap items-center justify-between gap-2 border-b border-surface-border px-[18px] py-3.5";
const CARD_TITLE = "text-[13px] font-bold text-ink-900";
const LABEL = "text-[11px] font-semibold uppercase tracking-wide text-ink-500";
const INPUT =
  "w-full min-w-0 rounded-lg border border-surface-border bg-surface-bg px-2.5 py-2 text-[13px] text-ink-900 outline-none transition-colors duration-150 focus:border-brand-green focus:bg-surface-card disabled:opacity-70";
const BTN =
  "inline-flex items-center justify-center gap-1.5 rounded-[9px] border border-brand-green bg-brand-green px-4 py-2 text-[13px] font-semibold text-on-primary transition-colors duration-150 hover:border-brand-green-dark hover:bg-brand-green-dark disabled:cursor-not-allowed disabled:opacity-60";
const BTN_GHOST =
  "inline-flex items-center justify-center gap-1.5 rounded-[9px] border border-surface-border bg-surface-card px-4 py-2 text-[13px] font-semibold text-ink-900 transition-colors duration-150 hover:bg-surface-bg disabled:cursor-not-allowed disabled:opacity-60";
const TAG = "inline-block whitespace-nowrap rounded-md px-2 py-0.5 text-[11px] font-medium";

function formatWhen(iso: string) {
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? "Date not recorded"
    : d.toLocaleString([], { dateStyle: "medium", timeStyle: "short" });
}

function fieldMessage(fields: Record<string, unknown> | undefined, name: string) {
  const value = fields ? new Map(Object.entries(fields)).get(name) : undefined;
  if (Array.isArray(value)) return value.map(String).join(" ");
  return typeof value === "string" ? value : null;
}

function Wording({ text }: { text: string }) {
  return (
    <div className="whitespace-pre-wrap break-words rounded-lg border border-surface-border bg-surface-bg px-3.5 py-3 text-[13px] leading-relaxed text-ink-900">
      {text}
    </div>
  );
}

function NewVersionForm({
  hasActive,
  onCreated,
}: {
  hasActive: boolean;
  onCreated: (template: ConsentTemplate) => void;
}) {
  const { accessToken } = useAuth();
  const [version, setVersion] = useState("");
  const [text, setText] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<{ version: string | null; text: string | null }>({
    version: null,
    text: null,
  });

  const ready = version.trim() !== "" && text.trim() !== "";

  const review = (e: FormEvent) => {
    e.preventDefault();
    if (!ready) return;
    setError(null);
    setConfirming(true);
  };

  const publish = () => {
    if (!accessToken || !ready) return;
    setSaving(true);
    setError(null);
    createConsentTemplate(accessToken, { version: version.trim(), text })
      .then((created) => {
        onCreated(created);
        setVersion("");
        setText("");
        setConfirming(false);
        setFieldErrors({ version: null, text: null });
      })
      .catch((err) => {
        if (err instanceof ApiError) {
          setFieldErrors({
            version: fieldMessage(err.fields, "version"),
            text: fieldMessage(err.fields, "text"),
          });
          setError(err.message);
        } else {
          setError("Couldn't save the new version.");
        }
        setConfirming(false);
      })
      .finally(() => setSaving(false));
  };

  return (
    <section className={CARD_CLASS} aria-labelledby="consent-new-version-title">
      <div className={CARD_HEADER}>
        <h2 id="consent-new-version-title" className={CARD_TITLE}>
          New version
        </h2>
      </div>
      <form className="grid gap-4 p-[18px]" onSubmit={review} noValidate>
        <div className="flex max-w-xs flex-col gap-1">
          <label htmlFor="consent-version" className={LABEL}>
            Version label
          </label>
          <input
            id="consent-version"
            className={INPUT}
            value={version}
            disabled={confirming || saving}
            aria-invalid={!!fieldErrors.version}
            aria-describedby={fieldErrors.version ? "consent-version-error" : undefined}
            onChange={(e) => {
              setVersion(e.target.value);
              setFieldErrors((prev) => ({ ...prev, version: null }));
            }}
          />
          {fieldErrors.version && (
            <span id="consent-version-error" className="text-xs text-status-red">
              {fieldErrors.version}
            </span>
          )}
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="consent-text" className={LABEL}>
            Consent wording
          </label>
          <textarea
            id="consent-text"
            rows={10}
            className={`${INPUT} leading-relaxed`}
            value={text}
            disabled={confirming || saving}
            aria-invalid={!!fieldErrors.text}
            aria-describedby={fieldErrors.text ? "consent-text-error" : undefined}
            onChange={(e) => {
              setText(e.target.value);
              setFieldErrors((prev) => ({ ...prev, text: null }));
            }}
          />
          {fieldErrors.text && (
            <span id="consent-text-error" className="text-xs text-status-red">
              {fieldErrors.text}
            </span>
          )}
        </div>

        {error && (
          <p
            role="alert"
            className="rounded-sm bg-status-red-tint px-3 py-2 text-sm text-status-red"
          >
            {error}
          </p>
        )}

        {confirming ? (
          <div
            role="alertdialog"
            aria-labelledby="consent-confirm-title"
            className="grid gap-3 rounded-lg border border-l-[3px] border-priority-orange bg-priority-orange-tint px-3.5 py-3 text-[12.5px] text-ink-900"
          >
            <p id="consent-confirm-title" className="font-semibold">
              Publish version &ldquo;{version.trim()}&rdquo; as the consent wording?
            </p>
            <p>
              From now on clinicians will record data-sharing consent against this exact wording.
              {hasActive && " The current version will be retired."} Published wording cannot be
              edited; a correction means publishing another version.
            </p>
            <div className="flex flex-wrap gap-2">
              <button type="button" className={BTN} disabled={saving} onClick={publish}>
                {saving ? "Publishing…" : "Publish version"}
              </button>
              <button
                type="button"
                className={BTN_GHOST}
                disabled={saving}
                onClick={() => setConfirming(false)}
              >
                Back to editing
              </button>
            </div>
          </div>
        ) : (
          <div>
            <button type="submit" className={BTN} disabled={!ready}>
              Review and publish
            </button>
          </div>
        )}
      </form>
    </section>
  );
}

export function ConsentWordingPage() {
  const { accessToken } = useAuth();
  const [templates, setTemplates] = useState<ConsentTemplate[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    if (!accessToken) return;
    let cancelled = false;
    listConsentTemplates(accessToken)
      .then((data) => !cancelled && setTemplates(data.results))
      .catch(
        (err) =>
          !cancelled &&
          setError(err instanceof ApiError ? err.message : "Couldn't load the consent wording."),
      );
    return () => {
      cancelled = true;
    };
  }, [accessToken]);

  const active = templates?.find((t) => t.active) ?? null;
  const history = templates?.filter((t) => !t.active) ?? [];

  const onCreated = (created: ConsentTemplate) => {
    setTemplates((prev) => [
      created,
      ...(prev ?? []).map((t) => (t.active ? { ...t, active: false } : t)),
    ]);
    setNotice(`Version “${created.version}” is now the active consent wording.`);
  };

  return (
    <div className="flex flex-col gap-6 animate-fade-in">
      <div>
        <div className="mb-1.5 text-[11px] font-bold uppercase tracking-wide text-brand-green">
          Organization · Clinical records
        </div>
        <h1 className="font-display text-2xl font-bold text-ink-900">Consent Wording</h1>
        <p className="mt-1 max-w-3xl text-sm text-ink-500">
          Clinicians record each client&rsquo;s data-sharing (HIE) consent against this exact
          wording, and every consent record keeps a copy of the version the client was shown. So the
          wording is never edited in place: changing it publishes a new version and retires the
          previous one, which stays in the history below. The wording is your facility&rsquo;s legal
          text — none is suggested or filled in for you.
        </p>
      </div>

      {error && (
        <p role="alert" className="rounded-sm bg-status-red-tint px-3 py-2 text-sm text-status-red">
          {error}
        </p>
      )}
      {notice && (
        <p
          role="status"
          className="rounded-sm bg-brand-green-tint px-3 py-2 text-sm text-brand-green-dark"
        >
          {notice}
        </p>
      )}
      {templates === null && !error && (
        <p className="text-sm text-ink-500">Loading consent wording…</p>
      )}

      {templates && (
        <>
          <section className={CARD_CLASS} aria-labelledby="consent-active-title">
            <div className={CARD_HEADER}>
              <h2 id="consent-active-title" className={CARD_TITLE}>
                Active version
              </h2>
              {active && (
                <span className={`${TAG} bg-brand-green-tint text-brand-green`}>
                  Version {active.version}
                </span>
              )}
            </div>
            <div className="p-[18px]">
              {active ? (
                <div className="grid gap-3">
                  <p className="text-xs text-ink-500">
                    Published {formatWhen(active.created_at)}
                    {active.created_by && ` by ${active.created_by}`}
                  </p>
                  <Wording text={active.text} />
                </div>
              ) : (
                <div className="flex gap-2.5 rounded-lg border border-l-[3px] border-priority-orange bg-priority-orange-tint px-3.5 py-3 text-[12.5px] text-priority-orange">
                  <div>
                    <strong>No consent wording is set.</strong> Clinicians can&rsquo;t record a
                    client&rsquo;s data-sharing consent until your facility publishes a version
                    below.
                  </div>
                </div>
              )}
            </div>
          </section>

          <NewVersionForm hasActive={!!active} onCreated={onCreated} />

          <section className={CARD_CLASS} aria-labelledby="consent-history-title">
            <div className={CARD_HEADER}>
              <h2 id="consent-history-title" className={CARD_TITLE}>
                Previous versions
              </h2>
              <span className={`${TAG} border border-surface-border bg-surface-bg text-ink-900`}>
                {history.length} {history.length === 1 ? "version" : "versions"}
              </span>
            </div>
            {history.length === 0 ? (
              <p className="px-5 py-8 text-center text-sm text-ink-500">
                No previous versions. Retired wording will be kept here.
              </p>
            ) : (
              <ul className="divide-y divide-surface-border">
                {history.map((template) => (
                  <li key={template.id}>
                    <details className="group px-[18px] py-3">
                      <summary className="flex cursor-pointer list-none flex-wrap items-center justify-between gap-2 rounded focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-green">
                        <span className="text-[13px] font-semibold text-ink-900">
                          Version {template.version}
                        </span>
                        <span className="flex items-center gap-2 text-xs text-ink-500">
                          {formatWhen(template.created_at)}
                          {template.created_by && ` · ${template.created_by}`}
                          <span className="font-semibold text-brand-green">
                            <span className="group-open:hidden">Show wording</span>
                            <span className="hidden group-open:inline">Hide wording</span>
                          </span>
                        </span>
                      </summary>
                      <div className="mt-3">
                        <Wording text={template.text} />
                      </div>
                    </details>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      )}
    </div>
  );
}
