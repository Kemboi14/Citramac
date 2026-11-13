import { useCallback, useEffect, useState } from "react";
import { useAuth } from "../../../auth/useAuth";
import {
  completeDeferredConsent,
  getCapacity,
  getVisitConsents,
  recordCapacity,
  recordVisitConsent,
  type CapacityRow,
  type PartySignatureRow,
  type SignatureInput,
  type VisitConsentRow,
} from "../../../lib/carePathwayApi";
import { SignaturePad } from "../shared/SignaturePad";
import { formatDateTime } from "../shared/format";
import { BTN, BTN_GHOST, BTN_SM, INPUT } from "../shared/styles";
import { Callout, Card, ErrorNote, Tag } from "../shared/ui";
import { useValueSets } from "../shared/useValueSets";
import { errorText } from "../triage/helpers";

const QUESTIONS = [
  ["understand", "Understands the information"],
  ["retain", "Retains it long enough to decide"],
  ["weigh", "Weighs it up to reach a decision"],
  ["communicate", "Communicates the decision"],
] as const;
const PARTIES = [
  ["PATIENT", "Patient"],
  ["GUARDIAN", "Parent / guardian (minor)"],
  ["SUBSTITUTE", "Substitute decision-maker"],
  ["DEFERRED", "Deferred — emergency"],
] as const;

/** Decision-specific capacity and consent. Capacity is judged per decision, never
 * as a blanket label, and each assessment is kept (a new one supersedes it). */
export function CapacityConsentCard({ patientId }: { patientId: string }) {
  const { accessToken } = useAuth();
  const vs = useValueSets();
  const [current, setCurrent] = useState<CapacityRow[]>([]);
  const [consents, setConsents] = useState<VisitConsentRow[]>([]);
  const [cap, setCap] = useState<Record<string, string>>({});
  const [completing, setCompleting] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    if (!accessToken) return;
    getCapacity(accessToken, patientId)
      .then((r) => setCurrent(r.current))
      .catch((e) => setError(errorText(e, "Couldn't load capacity.")));
    getVisitConsents(accessToken, patientId)
      .then((r) => setConsents(r.results))
      .catch(() => undefined);
  }, [accessToken, patientId]);
  useEffect(load, [load]);

  async function run(work: () => Promise<unknown>, after: () => void): Promise<boolean> {
    setError(null);
    try {
      await work();
      after();
      load();
      return true;
    } catch (e) {
      setError(errorText(e, "Couldn't save."));
      return false;
    }
  }

  const capReady = cap.decision && QUESTIONS.every(([k]) => cap[k]);
  return (
    <Card title="Capacity and consent for specific decisions">
      <ErrorNote>{error}</ErrorNote>
      {current.length === 0 ? (
        <p className="text-[13px] text-ink-500">No capacity assessments recorded.</p>
      ) : (
        <ul className="mb-3 flex flex-col gap-1 text-[13px]">
          {current.map((c) => (
            <li key={c.id} className="flex flex-wrap items-center gap-2">
              <Tag
                tone={
                  c.outcome === "Has capacity"
                    ? "brand"
                    : c.outcome === "Lacks capacity"
                      ? "risk"
                      : "warn"
                }
              >
                {c.outcome}
              </Tag>
              {vs.label("capacity-decision", c.decision)}
              {c.other_decision ? ` — ${c.other_decision}` : ""}
              <span className="text-ink-500">
                {c.assessed_by}, {formatDateTime(c.assessed_at)}
                {c.reassess_by ? ` · reassess by ${c.reassess_by}` : ""}
              </span>
            </li>
          ))}
        </ul>
      )}
      <fieldset className="mb-4 flex flex-wrap items-end gap-2 rounded-lg border border-surface-border p-3">
        <legend className="px-1 text-xs font-semibold">New capacity assessment</legend>
        <select
          className={INPUT}
          aria-label="Decision"
          value={cap.decision ?? ""}
          onChange={(e) => setCap({ ...cap, decision: e.target.value })}
        >
          <option value="">Decision in question…</option>
          {vs.options("capacity-decision").map((o) => (
            <option key={o.code} value={o.code}>
              {o.display}
            </option>
          ))}
        </select>
        {cap.decision === "OTHER" && (
          <input
            className={INPUT}
            placeholder="Specify"
            value={cap.other_decision ?? ""}
            onChange={(e) => setCap({ ...cap, other_decision: e.target.value })}
          />
        )}
        {QUESTIONS.map(([k, label]) => (
          <select
            key={k}
            className={INPUT}
            aria-label={label}
            value={cap[k] ?? ""}
            onChange={(e) => setCap({ ...cap, [k]: e.target.value })}
          >
            <option value="">{label}…</option>
            <option>Yes</option>
            <option>No</option>
            <option>Unsure</option>
          </select>
        ))}
        <input
          type="date"
          className={INPUT}
          aria-label="Reassess by"
          value={cap.reassess_by ?? ""}
          onChange={(e) => setCap({ ...cap, reassess_by: e.target.value })}
        />
        <button
          type="button"
          className={`${BTN} ${BTN_SM}`}
          disabled={!capReady}
          onClick={() =>
            void run(
              () => recordCapacity(accessToken!, patientId, cap),
              () => setCap({}),
            )
          }
        >
          Record
        </button>
      </fieldset>

      <h3 className="mb-1 text-sm font-semibold">Consent for this visit</h3>
      {consents.map((c) => (
        <div key={c.id} className="mb-2 text-[13px]">
          <Tag tone={c.open_deferred ? "risk" : "neutral"}>
            {c.open_deferred ? "Deferred — open" : PARTIES.find(([v]) => v === c.party)?.[1]}
          </Tag>{" "}
          {c.scope_label}
          {c.given_by_name && ` — ${c.given_by_name}`}{" "}
          <span className="text-ink-500">{formatDateTime(c.recorded_at)}</span>
          <SignatureSummary signatures={c.signatures} />
          {c.warnings.map((w) => (
            <Callout key={w} tone="warning" className="mt-1">
              {w}
            </Callout>
          ))}
          {c.open_deferred &&
            (completing === c.id ? (
              <ConsentForm
                mode="complete"
                onCancel={() => setCompleting(null)}
                onSubmit={(body) =>
                  run(
                    () =>
                      completeDeferredConsent(accessToken!, c.id, {
                        party: body.party as "PATIENT" | "GUARDIAN" | "SUBSTITUTE",
                        given_by_name: body.given_by_name,
                        signatures: body.signatures,
                      }),
                    () => setCompleting(null),
                  )
                }
              />
            ) : (
              <button
                type="button"
                className={`${BTN_GHOST} ${BTN_SM} ml-2`}
                onClick={() => setCompleting(c.id)}
              >
                Consent obtained — sign now
              </button>
            ))}
        </div>
      ))}
      <ConsentForm
        mode="new"
        onSubmit={(body) =>
          run(
            () => recordVisitConsent(accessToken!, patientId, body),
            () => undefined,
          )
        }
      />
    </Card>
  );
}

function SignatureSummary({ signatures }: { signatures: PartySignatureRow[] }) {
  if (!signatures.length) return null;
  return (
    <span className="block text-[12px] text-ink-500">
      {signatures
        .map((s) =>
          s.method === "UNABLE"
            ? `${s.signer_name} (${s.role_label.toLowerCase()}) unable to sign — ${s.unable_reason}`
            : `Signed by ${s.signer_name} (${s.role_label.toLowerCase()})`,
        )
        .join(" · ")}
    </span>
  );
}

type ConsentBody = {
  scope?: string;
  scope_detail?: string;
  party: string;
  given_by_name?: string;
  signatures: { party: SignatureInput; witness: SignatureInput };
};

/** A decision consent, signed on screen by whoever decides and by you as the
 * witness (2026-11-13). `complete` signs a deferred consent once obtained. */
function ConsentForm({
  mode,
  onSubmit,
  onCancel,
}: {
  mode: "new" | "complete";
  onSubmit: (body: ConsentBody) => Promise<boolean>;
  onCancel?: () => void;
}) {
  const vs = useValueSets();
  const [scope, setScope] = useState("");
  const [detail, setDetail] = useState("");
  const [party, setParty] = useState("PATIENT");
  const [name, setName] = useState("");
  const [relationship, setRelationship] = useState("");
  const [partySig, setPartySig] = useState<SignatureInput | null>(null);
  const [witness, setWitness] = useState<SignatureInput | null>(null);
  const [saving, setSaving] = useState(false);
  const [reset, setReset] = useState(0);

  const parties = mode === "new" ? PARTIES : PARTIES.filter(([v]) => v !== "DEFERRED");
  const deferred = party === "DEFERRED";
  const named = party === "GUARDIAN" || party === "SUBSTITUTE";
  const ready =
    (mode === "complete" || (scope && (scope !== "OTHER" || detail.trim()))) &&
    (!named || name.trim()) &&
    (deferred || (partySig && witness));

  async function submit() {
    setSaving(true);
    const ok = await onSubmit({
      ...(mode === "new" ? { scope, scope_detail: detail.trim() } : {}),
      party,
      given_by_name: named ? name.trim() : "",
      signatures: {
        party: { ...(partySig ?? {}), ...(named ? { relationship: relationship.trim() } : {}) },
        witness: witness ?? {},
      },
    });
    setSaving(false);
    if (ok) {
      setScope("");
      setDetail("");
      setParty("PATIENT");
      setName("");
      setRelationship("");
      setPartySig(null);
      setWitness(null);
      setReset((n) => n + 1);
    }
  }

  return (
    <div className="mt-2 flex flex-col gap-2 rounded-lg border border-surface-border p-3">
      <div className="flex flex-wrap items-center gap-2">
        {mode === "new" && (
          <select
            className={INPUT}
            aria-label="What is the consent for?"
            value={scope}
            onChange={(e) => setScope(e.target.value)}
          >
            <option value="">What is the consent for?…</option>
            {vs.options("capacity-decision").map((o) => (
              <option key={o.code} value={o.code}>
                {o.display}
              </option>
            ))}
          </select>
        )}
        {mode === "new" && scope === "OTHER" && (
          <input
            className={INPUT}
            placeholder="Which decision?"
            value={detail}
            onChange={(e) => setDetail(e.target.value)}
          />
        )}
        <select
          className={INPUT}
          aria-label="Who is consenting"
          value={party}
          onChange={(e) => {
            setParty(e.target.value);
            // The party's pad starts blank for the new signer.
            setPartySig(null);
          }}
        >
          {parties.map(([v, l]) => (
            <option key={v} value={v}>
              {l}
            </option>
          ))}
        </select>
        {named && (
          <>
            <input
              className={INPUT}
              placeholder="Name of person consenting"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
            <input
              className={INPUT}
              placeholder="Relationship to the client"
              value={relationship}
              onChange={(e) => setRelationship(e.target.value)}
            />
          </>
        )}
      </div>
      {deferred ? (
        <p className="text-[12px] text-ink-500">
          Nobody can consent yet. The consent is signed when it is obtained.
        </p>
      ) : (
        <div className="flex flex-wrap gap-2">
          <SignaturePad
            key={`party-${reset}-${party}`}
            label={
              party === "PATIENT"
                ? "Client's signature"
                : `${parties.find(([v]) => v === party)?.[1]}'s signature`
            }
            allowUnable
            onChange={setPartySig}
          />
          <SignaturePad
            key={`witness-${reset}`}
            label="Your signature as witness"
            onChange={setWitness}
          />
        </div>
      )}
      <div className="flex gap-2">
        <button
          type="button"
          className={`${BTN} ${BTN_SM}`}
          disabled={!ready || saving}
          onClick={() => void submit()}
        >
          {saving ? "Saving…" : "Record signed consent"}
        </button>
        {onCancel && (
          <button type="button" className={`${BTN_GHOST} ${BTN_SM}`} onClick={onCancel}>
            Cancel
          </button>
        )}
      </div>
    </div>
  );
}
