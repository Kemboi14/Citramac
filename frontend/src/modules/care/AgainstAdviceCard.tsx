import { useState } from "react";
import { useAuth } from "../../auth/useAuth";
import type { SignatureInput } from "../../lib/carePathwayApi";
import {
  recordAgainstAdvice,
  type AgainstAdviceStatus,
  type DischargePayload,
} from "../../lib/dischargeApi";
import { SignaturePad } from "./shared/SignaturePad";
import { formatDateTime } from "./shared/format";
import { BTN, BTN_SM } from "./shared/styles";
import { Callout, Card, ErrorNote, Tag } from "./shared/ui";
import { errorText } from "./triage/helpers";

const OUTCOME: Record<string, { label: string; tone: "brand" | "warn" }> = {
  DRAWN: { label: "Signed", tone: "brand" },
  UNABLE: { label: "Unable to sign", tone: "warn" },
  REFUSED: { label: "Refused to sign", tone: "warn" },
};

/**
 * A client leaving against medical advice acknowledges it against the
 * facility's own wording (Org Admin → Consent wording), drawn on screen — or
 * you record that they could not or would not sign, and why. You always sign as
 * witness (2026-11-26). The discharge never waits for this: a client who is
 * leaving cannot be held by a missing form.
 */
export function AgainstAdviceCard({
  admissionId,
  status,
  onRecorded,
}: {
  admissionId: string;
  status: AgainstAdviceStatus;
  onRecorded: (next: DischargePayload) => void;
}) {
  const { accessToken } = useAuth();
  const [client, setClient] = useState<SignatureInput | null>(null);
  const [witness, setWitness] = useState<SignatureInput | null>(null);
  const [round, setRound] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const record = async () => {
    if (!accessToken || !client || !witness) return;
    setBusy(true);
    setError(null);
    try {
      onRecorded(await recordAgainstAdvice(accessToken, admissionId, { client, witness }));
      setClient(null);
      setWitness(null);
      setRound((n) => n + 1);
    } catch (e) {
      // A failed save keeps the drawings.
      setError(errorText(e, "Couldn't record the acknowledgement."));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card title="Leaving against medical advice — client's acknowledgement">
      <div className="flex flex-col gap-3">
        <p className="text-[12.5px] text-ink-500">
          The discharge does not wait for this. Ask the client to sign; if they cannot or will not,
          record that and why.
        </p>
        {status.acknowledgements.length > 0 && (
          <ul className="flex flex-col gap-1 text-[13px]">
            {status.acknowledgements.map((a) => {
              const client = a.signatures.find((s) => s.role === "CLIENT");
              const outcome = OUTCOME[a.outcome];
              return (
                <li key={a.id} className="flex flex-wrap items-center gap-2">
                  {outcome && <Tag tone={outcome.tone}>{outcome.label}</Tag>}
                  <span>
                    {formatDateTime(a.recorded_at)} · wording version {a.wording_version} ·
                    witnessed by {a.recorded_by}
                    {client && client.method !== "DRAWN" ? ` — ${client.unable_reason}` : ""}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
        {status.wording ? (
          <>
            <div>
              <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-ink-500">
                Facility wording, version {status.wording.version}
              </p>
              <p className="whitespace-pre-wrap rounded-lg border border-surface-border bg-surface-bg px-3 py-2 text-[13px]">
                {status.wording.text}
              </p>
            </div>
            <ErrorNote>{error}</ErrorNote>
            <div className="flex flex-wrap gap-2">
              <SignaturePad
                key={`client-${round}`}
                label="Client's signature"
                allowUnable
                allowRefused
                onChange={setClient}
              />
              <SignaturePad
                key={`witness-${round}`}
                label="Your signature as witness"
                onChange={setWitness}
              />
            </div>
            <div>
              <button
                type="button"
                className={`${BTN} ${BTN_SM}`}
                disabled={busy || !client || !witness}
                onClick={() => void record()}
              >
                Record acknowledgement
              </button>
            </div>
          </>
        ) : (
          <Callout tone="warning">{status.no_wording_message}</Callout>
        )}
      </div>
    </Card>
  );
}
