import type { ContentItem, GeneratedDocument } from "../../../lib/documentsApi";
import { formatDateTime } from "../shared/format";

// Print / PDF-ready rendering of a generated document (DOC-GOV-05 footer:
// ID / version, generation time, author + credentials, facility, recipient /
// purpose, signature status). Watermarked DRAFT until signed (X-13).

const SOURCE_LABEL: Record<string, string> = {
  CLIENT_REPORT: "Client report",
  THIRD_PARTY_REPORT: "Third-party report",
  CLINICIAN_OBSERVATION: "Clinician observation",
  MEASUREMENT: "Measurement",
  ASSESSMENT_RESULT: "Assessment result",
  PREVIOUS_RECORD: "Record",
  CLINICIAN_ENTRY: "Clinician entry",
};

function Value({ value }: { value: ContentItem["value"] }) {
  if (value === null || value === undefined || (Array.isArray(value) && value.length === 0)) {
    return <span className="italic text-ink-500">Not recorded</span>;
  }
  if (Array.isArray(value)) {
    return (
      <ul className="list-disc pl-4">
        {value.map((v, i) => (
          <li key={i}>{v}</li>
        ))}
      </ul>
    );
  }
  return <span className="whitespace-pre-wrap">{value}</span>;
}

function Source({ item }: { item: ContentItem }) {
  if (!item.source) return null;
  return (
    <span className="ml-1 text-[10.5px] text-ink-500 print:text-[9px]">
      [{SOURCE_LABEL[item.source] ?? item.source}
      {item.recorded_at ? ` · ${formatDateTime(item.recorded_at)}` : ""}]
    </span>
  );
}

export function DocumentPreview({ doc }: { doc: GeneratedDocument }) {
  const c = doc.content;
  const signed = ["SIGNED", "RELEASED", "FILED"].includes(doc.status);
  return (
    <article
      className="document-print relative overflow-hidden rounded-lg border border-surface-border bg-white p-8 text-[13px] leading-relaxed text-black print:border-0 print:p-0"
      aria-label={`${c.title} preview`}
    >
      {doc.watermark && (
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 flex items-center justify-center"
        >
          <span className="-rotate-[30deg] select-none whitespace-nowrap text-[42px] font-black uppercase tracking-widest text-red-600/15">
            {doc.watermark}
          </span>
        </div>
      )}
      {doc.watermark && (
        <p className="mb-3 rounded border border-red-600 px-2 py-1 text-center text-[11px] font-bold uppercase tracking-wide text-red-700">
          {doc.watermark}
        </p>
      )}
      <header className="mb-5 border-b border-black/30 pb-3">
        <div className="text-[16px] font-bold">{c.facility.name ?? "Facility"}</div>
        <div className="text-[11.5px] text-black/70">
          {[c.facility.branch, c.facility.address, c.facility.phone, c.facility.email]
            .filter(Boolean)
            .join(" · ")}
        </div>
      </header>

      <h2 className="mb-1 text-[17px] font-bold">{c.title}</h2>
      <div className="mb-4 text-[11.5px] text-black/70">
        {doc.document_number} · version {doc.version}
      </div>

      {doc.recipient_type !== "INTERNAL_TEAM" && (
        <section className="mb-4">
          <div className="font-semibold">To</div>
          <div>
            {[c.recipient.name, c.recipient.organization].filter(Boolean).join(", ") ||
              c.recipient.type_label}
          </div>
          {c.purpose && <div className="text-black/70">Purpose: {c.purpose}</div>}
        </section>
      )}

      <section className="mb-4">
        <h3 className="mb-1 border-b border-black/20 text-[12px] font-bold uppercase tracking-wide">
          Client
        </h3>
        <dl className="grid grid-cols-[160px_1fr] gap-x-3 gap-y-0.5">
          {c.subject.map((item) => (
            <div key={item.key} className="contents">
              <dt className="text-black/70">{item.label}</dt>
              <dd>
                <Value value={item.value} />
              </dd>
            </div>
          ))}
        </dl>
      </section>

      {c.request.length > 0 && (
        <section className="mb-4">
          <h3 className="mb-1 border-b border-black/20 text-[12px] font-bold uppercase tracking-wide">
            Details
          </h3>
          <dl className="grid grid-cols-[160px_1fr] gap-x-3 gap-y-0.5">
            {c.request.map((item) => (
              <div key={item.key} className="contents">
                <dt className="text-black/70">{item.label}</dt>
                <dd>
                  <Value value={item.value} />
                </dd>
              </div>
            ))}
          </dl>
        </section>
      )}

      {c.sections.map((section) => (
        <section key={section.class} className="mb-4">
          <h3 className="mb-1 border-b border-black/20 text-[12px] font-bold uppercase tracking-wide">
            {section.title}
          </h3>
          <dl className="grid grid-cols-[160px_1fr] gap-x-3 gap-y-1">
            {section.items.map((item) => (
              <div key={item.key} className="contents">
                <dt className="text-black/70">{item.label}</dt>
                <dd>
                  <Value value={item.value} />
                  <Source item={item} />
                </dd>
              </div>
            ))}
          </dl>
        </section>
      ))}

      {c.monitoring.length > 0 && (
        <section className="mb-4">
          <h3 className="mb-1 border-b border-black/20 text-[12px] font-bold uppercase tracking-wide">
            Monitoring requested
          </h3>
          {c.monitoring.map((group) => (
            <div key={group.item_id} className="mb-2">
              <div className="font-semibold">
                {group.medication}
                {group.indication && ` — ${group.indication}`}
              </div>
              <div>Investigations (LOINC): {group.codes.join(", ") || "none selected"}</div>
              {(group.latest_results ?? []).length > 0 && (
                <ul className="list-disc pl-4 text-black/80">
                  {(group.latest_results ?? []).map((r, i) => (
                    <li key={i}>{r}</li>
                  ))}
                </ul>
              )}
            </div>
          ))}
        </section>
      )}

      {c.clinician_comment && (
        <section className="mb-4">
          <h3 className="mb-1 border-b border-black/20 text-[12px] font-bold uppercase tracking-wide">
            Clinician comment
          </h3>
          <p className="whitespace-pre-wrap">{c.clinician_comment}</p>
        </section>
      )}

      {c.verify_notice && (
        <p className="mb-4 rounded border border-amber-600 px-2 py-1 text-[11.5px] text-amber-800">
          Structured draft of record data only — {c.verify_notice}.
        </p>
      )}

      <footer className="mt-6 border-t border-black/30 pt-2 text-[10.5px] text-black/70">
        <div>
          {doc.document_number} v{doc.version} · generated {formatDateTime(doc.generated_at)} ·{" "}
          {c.organizer}
        </div>
        <div>
          Author: {c.author.name || "—"}
          {c.author.credentials ? ` (${c.author.credentials})` : ""} · Facility:{" "}
          {c.facility.name ?? "—"}
        </div>
        <div>
          Recipient: {c.recipient.type_label}
          {c.recipient.organization ? ` — ${c.recipient.organization}` : ""} · Purpose:{" "}
          {c.purpose || "—"}
        </div>
        <div>
          {signed
            ? `Signed by ${doc.signed_by} (${doc.signer_credentials}) on ${formatDateTime(doc.signed_at)} · content hash ${doc.content_hash.slice(0, 16)}…`
            : `Not signed — ${doc.status_label}`}
        </div>
        <div>Confidential — restricted health information.</div>
      </footer>
    </article>
  );
}
