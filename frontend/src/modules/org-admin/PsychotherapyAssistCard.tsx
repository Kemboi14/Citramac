import { useId, useState } from "react";
import { useAuth } from "../../auth/useAuth";
import {
  getPsyAssistSettings,
  updatePsyAssistSettings,
  type PsyAssistSettings,
} from "../../lib/psychotherapyNoteApi";
import { formatDateTime } from "../care/shared/format";
import { BTN, BTN_GHOST } from "../care/shared/styles";
import { Callout, Card, ErrorNote, Tag } from "../care/shared/ui";
import { useRecordData } from "../care/record/useRecordData";
import { errorText } from "../care/triage/helpers";

type Key = "ai_enabled" | "dictation_enabled";

const ITEMS: {
  key: Key;
  allowed: "ai_allowed" | "dictation_allowed";
  platform: "ai_platform_available" | "dictation_platform_available";
  title: string;
  what: string;
}[] = [
  {
    key: "ai_enabled",
    allowed: "ai_allowed",
    platform: "ai_platform_available",
    title: "AI-assisted psychotherapy notes",
    what: "Translates Kiswahili / Sheng answers into English and rewords the organised note in trauma-informed language. The clinician's session text is sent from the server to the AI provider (Anthropic). Used only for clients whose consent to AI-assisted note processing is recorded as Yes; the clinician still reviews, edits and signs every note.",
  },
  {
    key: "dictation_enabled",
    allowed: "dictation_allowed",
    platform: "dictation_platform_available",
    title: "Dictation in psychotherapy sessions",
    what: "Lets clinicians answer the guided questions by voice. Most browsers send the audio to the browser maker's speech service (for example Google or Apple) to transcribe it.",
  },
];

/** Org Admin: turn psychotherapy AI assistance and dictation on or off for the
 * organisation — only what the platform Super Admin has allowed, and turning
 * one on needs the data-protection attestation. Every change is audited. */
export function PsychotherapyAssistCard() {
  const { accessToken } = useAuth();
  const id = useId();
  const { data, error } = useRecordData(
    "psy-assist-settings",
    0,
    (token) => getPsyAssistSettings(token),
    "Couldn't load the psychotherapy assistance settings.",
  );
  const [saved, setSaved] = useState<PsyAssistSettings | null>(null);
  const [confirming, setConfirming] = useState<Key | null>(null);
  const [attest, setAttest] = useState(false);
  const [busy, setBusy] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const settings = saved ?? data;

  const change = async (key: Key, value: boolean) => {
    if (!accessToken) return;
    setBusy(true);
    setSaveError(null);
    try {
      setSaved(
        await updatePsyAssistSettings(accessToken, { [key]: value, attest: value || undefined }),
      );
      setConfirming(null);
      setAttest(false);
    } catch (err) {
      setSaveError(errorText(err, "Couldn't save the change."));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card title="Psychotherapy note assistance">
      <ErrorNote>{error ?? saveError}</ErrorNote>
      {!settings ? (
        !error && <p className="text-[13px] text-ink-500">Loading…</p>
      ) : (
        <div className="flex flex-col gap-4">
          {ITEMS.map((item) => {
            const on = settings[item.key];
            const allowed = settings[item.allowed];
            const platform = settings[item.platform];
            return (
              <section
                key={item.key}
                className="flex flex-col gap-2 rounded-lg border border-surface-border p-3.5"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="text-[13.5px] font-semibold text-ink-900">{item.title}</h3>
                  <Tag tone={on && allowed && platform ? "brand" : "neutral"}>
                    {on && allowed && platform ? "On" : "Off"}
                  </Tag>
                </div>
                <p className="text-xs text-ink-700">{item.what}</p>
                {!platform ? (
                  <p className="text-xs text-ink-500">
                    Not available on this server yet
                    {item.key === "ai_enabled"
                      ? " — the AI service key is not configured."
                      : "."}{" "}
                    Contact platform support.
                  </p>
                ) : !allowed ? (
                  <p className="text-xs text-ink-500">
                    Not allowed for your organisation. The platform Super Admin allows it once the
                    data-processing agreement covers it.
                  </p>
                ) : !settings.can_edit ? (
                  <p className="text-xs text-ink-500">Only an Org Admin can change this.</p>
                ) : on ? (
                  <div>
                    <button
                      type="button"
                      className={BTN_GHOST}
                      disabled={busy}
                      onClick={() => void change(item.key, false)}
                    >
                      Turn off
                    </button>
                  </div>
                ) : confirming === item.key ? (
                  <Callout tone="warning">
                    <div className="flex flex-col gap-2">
                      <label
                        htmlFor={`${id}-${item.key}`}
                        className="flex items-start gap-2 text-xs"
                      >
                        <input
                          id={`${id}-${item.key}`}
                          type="checkbox"
                          className="mt-0.5"
                          checked={attest}
                          onChange={(e) => setAttest(e.target.checked)}
                        />
                        <span>
                          I confirm our organisation&apos;s data-protection review approves this
                          processing of psychotherapy information, and that clients are told about
                          it. My name and the time are recorded.
                        </span>
                      </label>
                      <div className="flex gap-2">
                        <button
                          type="button"
                          className={BTN}
                          disabled={!attest || busy}
                          onClick={() => void change(item.key, true)}
                        >
                          Turn on
                        </button>
                        <button
                          type="button"
                          className={BTN_GHOST}
                          onClick={() => {
                            setConfirming(null);
                            setAttest(false);
                          }}
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  </Callout>
                ) : (
                  <div>
                    <button
                      type="button"
                      className={BTN}
                      onClick={() => {
                        setConfirming(item.key);
                        setAttest(false);
                      }}
                    >
                      Turn on…
                    </button>
                  </div>
                )}
              </section>
            );
          })}
          {settings.changed_at && (
            <p className="text-xs text-ink-500">
              Last changed by {settings.changed_by} · {formatDateTime(settings.changed_at)}
            </p>
          )}
        </div>
      )}
    </Card>
  );
}
