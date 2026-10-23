import { useEffect, useId, useState, type FormEvent, type ReactNode } from "react";
import { useAuth } from "../../auth/useAuth";
import { WideModal } from "../../components/WideModal";
import { ApiError } from "../../lib/apiClient";
import { getPatient, type PatientDetail } from "../../lib/clinicalApi";
import {
  IDENTIFICATION_TYPES,
  confirmClientRegistryMatch,
  searchClientRegistry,
  type ClientRegistryMatch,
  type ClientRegistrySearch,
  type RegistryIdentification,
} from "../../lib/clientRegistryApi";
import { formatDateTime } from "../care/shared/format";
import { BTN, BTN_GHOST, BTN_SM, INPUT, TABLE, TD, TH } from "../care/shared/styles";
import { Callout, ErrorNote, Field, Tag } from "../care/shared/ui";

const NONE = <span className="text-ink-400">Not recorded</span>;

function show(value: string | null | undefined): ReactNode {
  return value ? value : NONE;
}

/** Our record's identifiers, as the registration desk captured them. */
function ourIdentifiers(patient: PatientDetail) {
  const rows: string[] = [];
  if (patient.national_id) rows.push(`National ID: ${patient.national_id}`);
  if (patient.id_document_number && patient.id_document_number !== patient.national_id) {
    rows.push(`${patient.id_document_type || "ID document"}: ${patient.id_document_number}`);
  }
  if (patient.passport_number) rows.push(`Passport: ${patient.passport_number}`);
  if (patient.upi) rows.push(`UPI (IPRS): ${patient.upi}`);
  return rows;
}

function registryIdentifiers(match: ClientRegistryMatch) {
  return [match, ...match.other_identifications]
    .filter((i) => i.identification_number)
    .map((i) => `${i.identification_type}: ${i.identification_number}`);
}

function Lines({ lines }: { lines: string[] }) {
  if (lines.length === 0) return NONE;
  return (
    <ul className="flex flex-col gap-0.5">
      {lines.map((line) => (
        <li key={line}>{line}</li>
      ))}
    </ul>
  );
}

/**
 * DHA Client Registry lookup for an existing client (contract §4). The clerk
 * searches — by default with the client's own identifier — and compares the
 * registry's record side by side with ours. Only "This is the same person"
 * changes anything, and all it adds is a verified Client Registry ID: the
 * registry never overwrites our record. Held in memory only (CLAUDE.md §5).
 */
export function ClientRegistryLookup({
  patient,
  onConfirmed,
}: {
  patient: PatientDetail;
  onConfirmed: (updated: PatientDetail) => void;
}) {
  const { accessToken } = useAuth();
  const typeId = useId();
  const numberId = useId();
  const [idType, setIdType] = useState("");
  const [idNumber, setIdNumber] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ClientRegistrySearch | null>(null);
  const [verifiedCrId, setVerifiedCrId] = useState<string | null>(null);

  async function search(e: FormEvent) {
    e.preventDefault();
    if (!accessToken) return;
    if (idType && !idNumber.trim()) {
      setError("Enter the identifier number to search with.");
      return;
    }
    setBusy(true);
    setError(null);
    setResult(null);
    setVerifiedCrId(null);
    try {
      setResult(
        await searchClientRegistry(
          accessToken,
          patient.id,
          idType ? { identification_type: idType, identification_number: idNumber.trim() } : {},
        ),
      );
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't reach the Client Registry.");
    } finally {
      setBusy(false);
    }
  }

  async function confirm(match: ClientRegistryMatch, searched: RegistryIdentification) {
    if (!accessToken) return;
    setBusy(true);
    setError(null);
    try {
      const res = await confirmClientRegistryMatch(accessToken, patient.id, {
        cr_id: match.cr_id,
        ...searched,
      });
      setResult(null);
      setVerifiedCrId(res.match?.cr_id ?? match.cr_id);
      onConfirmed(res.patient);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't record the Client Registry ID.");
    } finally {
      setBusy(false);
    }
  }

  const match = result?.match ?? null;

  return (
    <div className="flex flex-col gap-3">
      <p className="text-[12.5px] text-ink-700">
        Search DHA&apos;s national Client Registry and compare its record with ours. The registry
        never overwrites our record — confirming a match only adds the verified Client Registry ID
        to this client&apos;s identifiers.
      </p>
      <form onSubmit={search} className="grid grid-cols-1 items-end gap-3 sm:grid-cols-3">
        <Field label="Identifier type" htmlFor={typeId}>
          <select
            id={typeId}
            className={INPUT}
            value={idType}
            disabled={busy}
            onChange={(e) => {
              setIdType(e.target.value);
              if (!e.target.value) setIdNumber("");
            }}
          >
            <option value="">The client&apos;s own identifier on file</option>
            {IDENTIFICATION_TYPES.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Identifier number" htmlFor={numberId}>
          <input
            id={numberId}
            className={INPUT}
            value={idNumber}
            disabled={busy || !idType}
            placeholder={idType ? "" : "Uses the identifier on file"}
            onChange={(e) => setIdNumber(e.target.value)}
          />
        </Field>
        <div>
          <button type="submit" className={BTN} disabled={busy}>
            {busy && !match ? "Searching…" : "Look up in Client Registry"}
          </button>
        </div>
      </form>

      <ErrorNote>{error}</ErrorNote>

      {verifiedCrId && (
        <Callout tone="success" role="status">
          Verified Client Registry ID <strong>{verifiedCrId}</strong> added to this client&apos;s
          identifiers. Nothing else in our record was changed.
        </Callout>
      )}

      {result && !match && (
        <Callout tone="warning" role="status">
          The Client Registry has no record for {result.searched.identification_type}{" "}
          {result.searched.identification_number}. Nothing was changed.
        </Callout>
      )}

      {result && match && (
        <div className="flex flex-col gap-3">
          <p className="text-[12px] text-ink-500">
            Searched with {result.searched.identification_type}{" "}
            {result.searched.identification_number}.
          </p>
          {match.deceased_datetime && (
            <Callout tone="danger" role="alert">
              The Client Registry records this person as deceased (
              {formatDateTime(match.deceased_datetime)}). Do not confirm unless you are certain this
              is the same person.
            </Callout>
          )}
          <div className="overflow-x-auto">
            <table className={TABLE}>
              <thead>
                <tr>
                  <th className={TH} />
                  <th className={TH}>Our record</th>
                  <th className={TH}>Client Registry</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <th className={TH}>First name</th>
                  <td className={TD}>{show(patient.first_name)}</td>
                  <td className={TD}>{show(match.first_name)}</td>
                </tr>
                <tr>
                  <th className={TH}>Middle / other names</th>
                  <td className={TD}>{show(patient.middle_other_names)}</td>
                  <td className={TD}>{show(match.middle_name)}</td>
                </tr>
                <tr>
                  <th className={TH}>Last name</th>
                  <td className={TD}>{show(patient.last_name)}</td>
                  <td className={TD}>{show(match.last_name)}</td>
                </tr>
                <tr>
                  <th className={TH}>Date of birth</th>
                  <td className={TD}>{show(patient.date_of_birth)}</td>
                  <td className={TD}>{show(match.date_of_birth)}</td>
                </tr>
                <tr>
                  <th className={TH}>Sex</th>
                  <td className={TD}>{show(patient.gender)}</td>
                  <td className={TD}>{show(match.gender)}</td>
                </tr>
                <tr>
                  <th className={TH}>Identifiers</th>
                  <td className={TD}>
                    <Lines lines={ourIdentifiers(patient)} />
                  </td>
                  <td className={TD}>
                    <div className="mb-1">
                      <Tag tone="brand">CR ID {match.cr_id}</Tag>
                    </div>
                    <Lines lines={registryIdentifiers(match)} />
                  </td>
                </tr>
                <tr>
                  <th className={TH}>County</th>
                  <td className={TD}>{show(patient.county)}</td>
                  <td className={TD}>
                    {show([match.county, match.sub_county].filter(Boolean).join(" · "))}
                  </td>
                </tr>
                <tr>
                  <th className={TH}>Dependants</th>
                  <td className={TD}>—</td>
                  <td className={TD}>{match.dependants}</td>
                </tr>
              </tbody>
            </table>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className={BTN}
              disabled={busy}
              onClick={() => void confirm(match, result.searched)}
            >
              {busy ? "Recording…" : "This is the same person"}
            </button>
            <button
              type="button"
              className={BTN_GHOST}
              disabled={busy}
              onClick={() => setResult(null)}
            >
              Not this person
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * The lookup opened from the client record header — loads our full record
 * (identifiers included) to compare against the registry's.
 */
export function ClientRegistryLookupModal({
  open,
  patientId,
  onClose,
  onConfirmed,
}: {
  open: boolean;
  patientId: string;
  onClose: () => void;
  onConfirmed: () => void;
}) {
  const { accessToken } = useAuth();
  const [patient, setPatient] = useState<PatientDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open || !accessToken) return;
    let cancelled = false;
    getPatient(accessToken, patientId)
      .then((p) => {
        if (!cancelled) {
          setPatient(p);
          setError(null);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err instanceof ApiError ? err.message : "Couldn't load the client's details.");
        }
      });
    return () => {
      cancelled = true;
    };
  }, [open, accessToken, patientId]);

  const loaded = patient && patient.id === patientId ? patient : null;

  return (
    <WideModal
      open={open}
      onClose={onClose}
      title="National Client Registry"
      subtitle={loaded ? `${loaded.first_name} ${loaded.last_name}` : undefined}
      footer={
        <button type="button" className={`${BTN_GHOST} ${BTN_SM}`} onClick={onClose}>
          Close
        </button>
      }
    >
      <ErrorNote>{error}</ErrorNote>
      {!loaded && !error && <p className="text-[13px] text-ink-500">Loading…</p>}
      {loaded && (
        <ClientRegistryLookup
          key={loaded.id}
          patient={loaded}
          onConfirmed={(updated) => {
            setPatient(updated);
            onConfirmed();
          }}
        />
      )}
    </WideModal>
  );
}
