import { useRef, useState } from "react";
import { DocumentActions } from "../../../../components/DocumentActions";
import {
  changeApplicationType,
  signLegalDocument,
  uploadLegalDocumentCopy,
  type LegalCategory,
  type LegalDocumentRow,
} from "../../../../lib/legalStatusApi";
import { BTN, BTN_GHOST, BTN_SM, INPUT } from "../../shared/styles";

type Runner = (fn: (token: string) => Promise<unknown>, fallback: string) => Promise<boolean>;

const ACCEPT = ".pdf,.png,.jpg,.jpeg,application/pdf,image/png,image/jpeg";

function Step({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <div className="flex gap-3">
      <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-brand-green-tint text-[12px] font-bold text-brand-green-dark">
        {n}
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <p className="text-[13px] font-semibold text-ink-900">{title}</p>
        {children}
      </div>
    </div>
  );
}

/**
 * Signing a voluntary or involuntary application: print it, the applicant
 * signs the paper, upload the signed copy — which records the application as
 * signed by the applicant (wet signature, scan) and files the copy in the
 * client's attachments. An electronic signature witnessed in person remains
 * available.
 *
 * `signer` carries the applicant fields the form collected (signer_kind,
 * related_person_id, adult_confirmed); `beforeSign` saves the draft first.
 */
export function ApplicationSignature({
  doc,
  signer,
  busy,
  run,
  beforeSign,
}: {
  doc: LegalDocumentRow;
  signer: Record<string, unknown>;
  busy: boolean;
  run: Runner;
  beforeSign?: () => Promise<boolean>;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [method, setMethod] = useState<"UPLOAD" | "ELECTRONIC">("UPLOAD");
  const [file, setFile] = useState<File | null>(null);
  const [attested, setAttested] = useState(false);
  const filename = `${doc.document_number}-v${doc.version}`.replace(/[^A-Za-z0-9._-]+/g, "-");

  const ready = async () => (beforeSign ? beforeSign() : true);

  const uploadAndSign = async () => {
    if (!file || !(await ready())) return;
    const ok = await run(
      (t) =>
        uploadLegalDocumentCopy(t, doc.id, file, {
          signer_kind: signer.signer_kind as string | undefined,
          related_person_id: signer.related_person_id as string | undefined,
          adult_confirmed: Boolean(signer.adult_confirmed),
        }),
      "Couldn't record the signed copy.",
    );
    if (ok) {
      setFile(null);
      if (input.current) input.current.value = "";
    }
  };

  const signElectronically = async () => {
    if (!(await ready())) return;
    await run(
      (t) => signLegalDocument(t, doc.id, { ...signer, method: "ELECTRONIC", attested }),
      "Couldn't sign the application.",
    );
  };

  return (
    <div className="flex flex-col gap-4 rounded-xl border border-surface-border bg-surface-bg p-4">
      <Step n={1} title="Print the form for the applicant to sign">
        <div className="flex flex-wrap items-center gap-2">
          <DocumentActions
            path={`/care/legal/documents/${doc.id}/print/`}
            filename={filename}
            label={`${doc.title} (${doc.document_number} v${doc.version})`}
          />
          <span className="text-[12px] text-ink-500">
            Complete the form above first — the print shows what has been saved.
          </span>
        </div>
      </Step>

      <Step n={2} title="Record the applicant's signature">
        <div className="flex flex-wrap gap-4 text-[13px]">
          <label className="inline-flex items-center gap-1.5">
            <input
              type="radio"
              checked={method === "UPLOAD"}
              onChange={() => setMethod("UPLOAD")}
            />
            Upload the signed paper form
          </label>
          <label className="inline-flex items-center gap-1.5">
            <input
              type="radio"
              checked={method === "ELECTRONIC"}
              onChange={() => setMethod("ELECTRONIC")}
            />
            Electronic signature, signed in my presence
          </label>
        </div>

        {method === "UPLOAD" ? (
          <div className="flex flex-col gap-2">
            <div className="flex flex-wrap items-center gap-2">
              <input
                ref={input}
                type="file"
                accept={ACCEPT}
                className="hidden"
                aria-label={`Signed copy of ${doc.title}`}
                onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              />
              <button
                type="button"
                className={`${BTN_GHOST} ${BTN_SM}`}
                disabled={busy}
                onClick={() => input.current?.click()}
              >
                {file ? "Choose a different file" : "Choose signed copy"}
              </button>
              <span className="text-[12.5px] text-ink-700">
                {file ? file.name : "PDF, PNG or JPEG, up to 10 MB"}
              </span>
            </div>
            <div>
              <button
                type="button"
                className={`${BTN} ${BTN_SM}`}
                disabled={busy || !file}
                onClick={() => void uploadAndSign()}
              >
                Upload and record as signed
              </button>
            </div>
            <p className="text-[11.5px] text-ink-500">
              The upload is the applicant&rsquo;s signature: the application is recorded as signed
              by the applicant, with your name as the person who captured it, and the copy is kept
              in the client&rsquo;s attachments.
            </p>
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            <label className="inline-flex items-center gap-1.5 text-[13px]">
              <input
                type="checkbox"
                checked={attested}
                onChange={(e) => setAttested(e.target.checked)}
              />
              I confirm the applicant signed in my presence
            </label>
            <div>
              <button
                type="button"
                className={`${BTN} ${BTN_SM}`}
                disabled={busy || !attested}
                onClick={() => void signElectronically()}
              >
                Sign
              </button>
            </div>
          </div>
        )}
      </Step>
    </div>
  );
}

/** Correct a wrong Voluntary / Involuntary choice before the admitting officer
 * decides. A signed application needs a reason; it is withdrawn, never deleted. */
export function ChangeApplicationType({
  doc,
  current,
  patientId,
  busy,
  run,
}: {
  doc: LegalDocumentRow;
  /** The pending application's type. */
  current: LegalCategory;
  patientId: string;
  busy: boolean;
  run: Runner;
}) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const other: LegalCategory = current === "VOLUNTARY" ? "INVOLUNTARY" : "VOLUNTARY";
  const signed = doc.status === "SIGNED";
  const needsReason = signed && reason.trim().length < 5;

  return (
    <div className="flex flex-col gap-2 rounded-lg border border-surface-border px-3 py-2.5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-[13px] text-ink-700">
          Admission type: <strong>{current === "VOLUNTARY" ? "Voluntary" : "Involuntary"}</strong>
        </p>
        <button
          type="button"
          className={`${BTN_GHOST} ${BTN_SM}`}
          disabled={busy}
          onClick={() => setOpen(!open)}
        >
          Change to {other.toLowerCase()}
        </button>
      </div>
      {open && (
        <div className="flex flex-col gap-2">
          <p className="text-[12.5px] text-ink-500">
            {signed
              ? "This application is already signed. It will be withdrawn (kept in the record, marked withdrawn) together with any recommendation made for it, and a new application started."
              : "The unsigned draft will be withdrawn and a new application started."}
          </p>
          {signed && (
            <input
              className={INPUT}
              placeholder="Why is the admission type being changed?"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          )}
          <div className="flex gap-2">
            <button
              type="button"
              className={`${BTN} ${BTN_SM}`}
              disabled={busy || needsReason}
              onClick={async () => {
                if (
                  await run(
                    (t) => changeApplicationType(t, patientId, other, reason),
                    "Couldn't change the admission type.",
                  )
                ) {
                  setOpen(false);
                  setReason("");
                }
              }}
            >
              Change to {other.toLowerCase()} admission
            </button>
            <button
              type="button"
              className={`${BTN_GHOST} ${BTN_SM}`}
              onClick={() => setOpen(false)}
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
