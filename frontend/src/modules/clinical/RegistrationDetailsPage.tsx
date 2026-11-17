import { useEffect, useState, type ReactNode } from "react";
import { Link, useParams } from "react-router-dom";
import { Loader2 } from "lucide-react";
import { useAuth } from "../../auth/useAuth";
import { ApiError } from "../../lib/apiClient";
import { getRegistration, type RegistrationRow } from "../../lib/carePathwayApi";
import { Breadcrumbs, useTrail } from "../care/shared/Breadcrumbs";
import { clientReportPath } from "../care/shared/recordRoutes";
import { BTN_GHOST } from "../care/shared/styles";
import { ErrorNote, PageHeader } from "../care/shared/ui";
import { CLIENT_CHANGED_EVENT } from "../care/shared/useClientBanner";
import { useValueSets } from "../care/shared/useValueSets";

/**
 * A client's details as registered, read-only, on a page of its own. Loaded
 * fresh each time it opens, and again whenever anything on the page reports the client changed,
 * so it always shows the saved record. Reading it is an audited client-record
 * read on the server, like any other.
 */
export function RegistrationDetailsPage() {
  const { patientId = "" } = useParams();
  const { accessToken } = useAuth();
  const vs = useValueSets();
  const [loaded, setLoaded] = useState<{ id: string; row: RegistrationRow } | null>(null);
  const [error, setError] = useState<{ id: string; message: string } | null>(null);
  const [nudge, setNudge] = useState(0);

  useEffect(() => {
    if (!accessToken || !patientId) return;
    let cancelled = false;
    getRegistration(accessToken, patientId)
      .then((row) => {
        if (cancelled) return;
        setLoaded({ id: patientId, row });
        setError(null);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError({
          id: patientId,
          message: err instanceof ApiError ? err.message : "Couldn't load the details.",
        });
      });
    return () => {
      cancelled = true;
    };
  }, [accessToken, patientId, nudge]);

  useEffect(() => {
    if (!patientId) return;
    const onChanged = (event: Event) => {
      if ((event as CustomEvent<string>).detail === patientId) setNudge((n) => n + 1);
    };
    window.addEventListener(CLIENT_CHANGED_EVENT, onChanged);
    return () => window.removeEventListener(CLIENT_CHANGED_EVENT, onChanged);
  }, [patientId]);

  const row = loaded && loaded.id === patientId ? loaded.row : null;
  const failed = error && error.id === patientId ? error.message : null;
  const trail = useTrail(
    [{ label: "Clients", to: "/clinical/registry" }],
    row ? `Registration details — ${row.name}` : "Registration details",
  );
  const label = (set: string, code: string) => (code ? vs.label(set, code) : "");

  return (
    <div className="animate-fade-in">
      <Breadcrumbs items={trail.items} />
      <PageHeader
        title="Registration details"
        subtitle={row ? `${row.name} · ${row.citramac_number} · ${row.identity_label}` : undefined}
        actions={
          row && (
            <Link
              to={clientReportPath(patientId)}
              state={{ trail: trail.onward }}
              className={BTN_GHOST}
            >
              Client report
            </Link>
          )
        }
      />
      {failed ? (
        <ErrorNote>{failed}</ErrorNote>
      ) : !row ? (
        <p role="status" className="flex items-center gap-2 text-sm text-ink-500">
          <Loader2 aria-hidden className="h-4 w-4 animate-spin" /> Loading details…
        </p>
      ) : (
        <div className="flex flex-col gap-5">
          <p className="rounded-lg bg-surface-bg px-3 py-2 text-xs text-ink-500">
            Read-only. This shows the record as currently saved.
          </p>
          <Section title="Identity">
            {row.is_temporary && (
              <Item label="Description / temporary alias" value={row.identity_description} wide />
            )}
            <Item label="First name" value={row.first_name} />
            <Item label="Middle / other names" value={row.middle_other_names} />
            <Item label="Last name" value={row.last_name} />
            <Item label="Preferred name" value={row.preferred_name} />
            <Item label="Pronouns" value={label("pronouns", row.pronouns)} />
            <Item label="Sex" value={label("sex", row.sex)} />
            <Item
              label="Date of birth"
              value={
                row.date_of_birth
                  ? formatDate(row.date_of_birth)
                  : row.estimated_age != null
                    ? `Not known (estimated age ${row.estimated_age})`
                    : ""
              }
            />
            <Item label="Age" value={row.age != null ? `${row.age} years` : ""} />
          </Section>
          <Section title="Contact & identification">
            <Item label="Mobile phone" value={row.phone} />
            <Item label="Address / location" value={row.address} wide />
            <Item label="ID / passport" value={label("id-document-type", row.id_document_type)} />
            <Item label="Document number" value={row.id_document_number} />
            {(row.identifiers ?? [])
              .filter((identifier) => !identifier.superseded)
              .map((identifier) => (
                <Item
                  key={`${identifier.kind}-${identifier.value}`}
                  label={humanize(identifier.kind)}
                  value={identifier.value}
                />
              ))}
            <Item label="Preferred language" value={row.preferred_language} />
            <Item label="Interpreter" value={humanize(row.interpreter)} />
          </Section>
          <Section title="Next of kin / emergency contact">
            <Item label="Name" value={row.next_of_kin} />
            <Item label="Relationship" value={row.next_of_kin_relationship} />
            <Item label="Phone" value={row.next_of_kin_phone} />
          </Section>
          <Section title="Social & personal">
            <Item
              label="Living with a disability"
              value={label("disability-status", row.living_with_disability)}
            />
            {row.disability_details && (
              <Item label="Disability / support needs" value={row.disability_details} wide />
            )}
            <Item
              label="Employment status"
              value={label("employment-status", row.employment_status)}
            />
            <Item label="Occupation" value={row.occupation} />
            <Item label="Marital status" value={label("marital-status", row.marital_status)} />
          </Section>
          <Section title="Referral, allergies & payment">
            <Item label="Referral source" value={row.referral_source} />
            <Item label="Payer / insurance" value={label("payer", row.payer)} />
            <Item
              label="Allergy status"
              value={label("registration-allergy-status", row.allergy_status)}
            />
            {row.allergy_details && (
              <Item label="Allergy & reaction details" value={row.allergy_details} wide />
            )}
          </Section>
          {row.emergency_arrival && (
            <Section title="Emergency arrival">
              <Item
                label="Arrival / contact"
                value={
                  row.emergency_arrival.arrival_at
                    ? formatDateTime(row.emergency_arrival.arrival_at)
                    : ""
                }
              />
              <Item label="Found at" value={row.emergency_arrival.found_location} />
              <Item
                label="Arrival / referral information"
                value={row.emergency_arrival.arrival_referral_info}
                wide
              />
              <Item
                label="Identification notes"
                value={row.emergency_arrival.identification_notes}
                wide
              />
              <Item label="Brought by" value={row.emergency_arrival.brought_by?.name ?? ""} />
              <Item
                label="Relationship"
                value={row.emergency_arrival.brought_by?.relationship ?? ""}
              />
              <Item label="Their phone" value={row.emergency_arrival.brought_by?.phone ?? ""} />
            </Section>
          )}
        </div>
      )}
    </div>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section>
      <h3 className="mb-2 text-xs font-bold uppercase tracking-wide text-ink-500">{title}</h3>
      <dl className="grid grid-cols-1 gap-x-6 gap-y-3 rounded-xl border border-surface-border bg-surface-card px-5 py-4 sm:grid-cols-3">
        {children}
      </dl>
    </section>
  );
}

function Item({ label, value, wide }: { label: string; value: string; wide?: boolean }) {
  return (
    <div className={`min-w-0 ${wide ? "sm:col-span-3" : ""}`}>
      <dt className="text-[11px] font-semibold text-ink-500">{label}</dt>
      <dd className={`break-words text-[13px] ${value ? "text-ink-900" : "text-ink-300"}`}>
        {value || "Not recorded"}
      </dd>
    </div>
  );
}

const humanize = (text: string) => {
  const spaced = (text || "").replace(/[_-]+/g, " ").trim().toLowerCase();
  return spaced ? spaced[0].toUpperCase() + spaced.slice(1) : "";
};

const formatDate = (iso: string) => {
  const date = new Date(`${iso}T00:00:00`);
  return Number.isNaN(date.getTime())
    ? iso
    : date.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
};

const formatDateTime = (iso: string) => {
  const date = new Date(iso);
  return Number.isNaN(date.getTime())
    ? iso
    : date.toLocaleString("en-GB", {
        day: "numeric",
        month: "short",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      });
};
