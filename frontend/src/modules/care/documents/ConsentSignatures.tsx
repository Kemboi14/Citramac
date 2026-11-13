import { useState } from "react";
import type { SignatureInput } from "../../../lib/carePathwayApi";
import type { GeneratedDocument } from "../../../lib/documentsApi";
import { SignaturePad } from "../shared/SignaturePad";
import { formatDateTime } from "../shared/format";
import { BTN, BTN_SM, INPUT } from "../shared/styles";
import { Callout, Card, Tag } from "../shared/ui";

/**
 * A consent document's on-screen signatures (owner decisions 2026-11-13): the
 * client — or their parent / guardian when they are a minor, or a substitute
 * decision-maker — the family member on a family-involvement consent, and you as
 * the witness each time. They are taken on the draft, before you authorise it;
 * changing the draft afterwards means signing again.
 */
export function ConsentSignatures({
  doc,
  busy,
  onSign,
}: {
  doc: GeneratedDocument;
  busy: boolean;
  /** `done` runs once the signature is saved, so a failed save keeps the drawings. */
  onSign: (
    body: { role: string; party: SignatureInput; witness: SignatureInput },
    done: () => void,
  ) => void;
}) {
  const roles = doc.signature_roles ?? [];
  const [role, setRole] = useState<string>(doc.client_is_minor ? "GUARDIAN" : "CLIENT");
  const [name, setName] = useState("");
  const [relationship, setRelationship] = useState("");
  const [contactId, setContactId] = useState("");
  const [party, setParty] = useState<SignatureInput | null>(null);
  const [witness, setWitness] = useState<SignatureInput | null>(null);
  const [round, setRound] = useState(0);

  const open = doc.status === "DRAFT" || doc.status === "IN_REVIEW";
  const contacts = doc.contacts ?? [];
  const needsContact = role === "RELATED_PERSON";
  const named = role !== "CLIENT";
  const current = doc.party_signatures.filter((s) => s.current);
  const stale = doc.party_signatures.length - current.length;
  const ready =
    doc.wording && party && witness && (!named || name.trim()) && (!needsContact || contactId);

  const chooseContact = (id: string) => {
    setContactId(id);
    const contact = contacts.find((c) => c.id === id);
    if (contact) {
      setName(contact.name);
      setRelationship(contact.relationship);
    }
  };

  const submit = () => {
    onSign(
      {
        role,
        party: {
          ...(party ?? {}),
          ...(named ? { name: name.trim(), relationship: relationship.trim() } : {}),
          ...(contactId ? { related_person_id: contactId } : {}),
        },
        witness: witness ?? {},
      },
      () => {
        setParty(null);
        setWitness(null);
        setName("");
        setRelationship("");
        setContactId("");
        setRound((n) => n + 1);
      },
    );
  };

  return (
    <Card title="Consent signatures">
      {doc.wording ? (
        <div className="mb-3">
          <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-ink-500">
            Facility wording, version {doc.wording.version}
          </p>
          <p className="whitespace-pre-wrap rounded-lg border border-surface-border bg-surface-bg px-3 py-2 text-[13px]">
            {doc.wording.text}
          </p>
        </div>
      ) : (
        <Callout tone="warning" className="mb-3">
          The facility has not set its wording for this consent (Org Admin → Consent wording), so it
          cannot be signed.
        </Callout>
      )}
      <ul className="mb-3 flex flex-col gap-1 text-[13px]">
        {doc.signature_requirements.map((r) => (
          <li key={r.key} className="flex items-center gap-2">
            <Tag tone={r.satisfied ? "brand" : "warn"}>{r.satisfied ? "Signed" : "Needed"}</Tag>
            {r.label}
          </li>
        ))}
      </ul>
      {current.length > 0 && (
        <ul className="mb-3 flex flex-col gap-0.5 text-[12.5px] text-ink-700">
          {current.map((s) => (
            <li key={s.id}>
              {s.signer_name} — {s.role_label}
              {s.relationship ? ` (${s.relationship})` : ""}
              {s.method === "UNABLE" ? `: unable to sign — ${s.unable_reason}` : ""} ·{" "}
              {formatDateTime(s.captured_at)}
            </li>
          ))}
        </ul>
      )}
      {stale > 0 && (
        <p className="mb-3 text-[12px] text-ink-500">
          {stale} earlier signature{stale === 1 ? " was" : "s were"} on a version that has since
          changed and no longer count.
        </p>
      )}
      {open && doc.wording && (
        <div className="flex flex-col gap-2 rounded-lg border border-surface-border p-3">
          <div className="flex flex-wrap items-center gap-2">
            <select
              className={INPUT}
              aria-label="Who is signing"
              value={role}
              onChange={(e) => {
                setRole(e.target.value);
                setParty(null);
                setContactId("");
                setName("");
                setRelationship("");
              }}
            >
              {roles
                .filter((r) => !(doc.client_is_minor && r.code === "CLIENT"))
                .map((r) => (
                  <option key={r.code} value={r.code}>
                    {r.label}
                  </option>
                ))}
            </select>
            {named && contacts.length > 0 && (
              <select
                className={INPUT}
                aria-label="Choose from the client's contacts"
                value={contactId}
                onChange={(e) => chooseContact(e.target.value)}
              >
                <option value="">
                  {needsContact ? "Choose the family member…" : "From the client's contacts…"}
                </option>
                {contacts.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                    {c.relationship ? ` (${c.relationship})` : ""}
                  </option>
                ))}
              </select>
            )}
            {named && !needsContact && (
              <>
                <input
                  className={INPUT}
                  placeholder="Name of the person signing"
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
          {needsContact && contacts.length === 0 && (
            <Callout tone="warning">
              Add the family member to the client&apos;s contacts first.
            </Callout>
          )}
          <div className="flex flex-wrap gap-2">
            <SignaturePad
              key={`party-${round}-${role}`}
              label={role === "CLIENT" ? "Client's signature" : "Signature"}
              allowUnable
              onChange={setParty}
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
              disabled={!ready || busy}
              onClick={submit}
            >
              Add signature
            </button>
          </div>
        </div>
      )}
    </Card>
  );
}
