import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useAuth } from "../../auth/useAuth";
import { ApiError } from "../../lib/apiClient";
import { updateAppointment } from "../../lib/appointmentsApi";
import { searchRegistrations, type RegistrationRow } from "../../lib/carePathwayApi";
import {
  bookFollowUp,
  getFollowUps,
  type FollowUpAppointmentRow,
  type FollowUpBucket,
  type FollowUpOverview,
  type FollowUpUnbookedRow,
} from "../../lib/dischargeApi";
import { EmptyState } from "../../components/EmptyState";
import { TableSkeletonRows } from "../../components/Skeleton";
import { formatDateTime, newRequestId } from "./shared/format";
import { SortHeader, TableFilter } from "./shared/TableControls";
import { useTableControls } from "./shared/useTableControls";
import { clientRecordPath } from "./shared/recordRoutes";
import { BTN, BTN_GHOST, BTN_SM, INPUT, TABLE, TD, TH } from "./shared/styles";
import { useValueSets } from "./shared/useValueSets";
import { Callout, Card, ErrorNote, Field, PageHeader, SelectChoices, Tag } from "./shared/ui";

// docs/17-DISCHARGE-AND-FOLLOW-UP.md — what is coming up, what was missed and who
// left hospital with nothing booked.

const BUCKETS: { key: FollowUpBucket; label: string; empty: string }[] = [
  { key: "upcoming", label: "Upcoming", empty: "No follow-up appointments are coming up." },
  { key: "overdue", label: "Overdue", empty: "No follow-ups are overdue." },
  { key: "missed", label: "Missed (90 days)", empty: "No missed follow-ups in the last 90 days." },
  {
    key: "unbooked",
    label: "Discharged, no follow-up booked",
    empty: "Everyone discharged in the last 30 days has a follow-up booked.",
  },
];

const APPOINTMENT_SORTS = {
  client: (row: FollowUpAppointmentRow) => row.patient_name,
  when: (row: FollowUpAppointmentRow) => new Date(row.scheduled_for).getTime(),
  reason: (row: FollowUpAppointmentRow) => row.reason_label,
};
const appointmentSearch = (row: FollowUpAppointmentRow) =>
  [row.patient_name, row.citramac_number, row.reason_label, row.provider_name].join(" ");
const UNBOOKED_SORTS = {
  client: (row: FollowUpUnbookedRow) => row.patient_name,
  discharged: (row: FollowUpUnbookedRow) => new Date(row.discharged_at).getTime(),
  waiting: (row: FollowUpUnbookedRow) => row.days_since_discharge,
};
const unbookedSearch = (row: FollowUpUnbookedRow) =>
  [row.patient_name, row.citramac_number].join(" ");

interface BookingTarget {
  patientId?: string;
  admissionId?: string;
  name: string;
  defaultReason: string;
}

export function FollowUpPage() {
  const { accessToken } = useAuth();
  const [params] = useSearchParams();
  const requested = BUCKETS.find((b) => b.key === params.get("bucket"));
  const [bucket, setBucket] = useState<FollowUpBucket>(requested?.key ?? "upcoming");
  const [data, setData] = useState<FollowUpOverview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [booking, setBooking] = useState<BookingTarget | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!accessToken) return;
    try {
      setData(await getFollowUps(accessToken, bucket));
      setError(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't load follow-ups.");
    }
  }, [accessToken, bucket]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- fetch on mount / bucket change.
    void load();
  }, [load]);

  const markNoShow = async (row: FollowUpAppointmentRow) => {
    if (!accessToken) return;
    setBusyId(row.id);
    setError(null);
    try {
      await updateAppointment(accessToken, row.id, { status: "NO_SHOW" });
      setNotice(`${row.patient_name} marked as a no-show.`);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't update the appointment.");
    } finally {
      setBusyId(null);
    }
  };

  const meta = BUCKETS.find((b) => b.key === bucket) ?? BUCKETS[0];

  return (
    <div className="animate-fade-in">
      <PageHeader
        eyebrow="Appointments & follow-up"
        title="Follow-up"
        subtitle="Upcoming and missed follow-ups, and clients discharged with none booked"
        actions={
          <button
            type="button"
            className={BTN}
            onClick={() => setBooking({ name: "", defaultReason: "MEDICATION_REVIEW" })}
          >
            + Book follow-up
          </button>
        }
      />

      {notice && (
        <div className="mb-4">
          <Callout tone="success" role="status">
            {notice}
          </Callout>
        </div>
      )}
      {error && (
        <div className="mb-4">
          <ErrorNote>{error}</ErrorNote>
        </div>
      )}

      {booking && (
        <BookingForm
          key={`${booking.patientId ?? ""}${booking.admissionId ?? ""}`}
          target={booking}
          onCancel={() => setBooking(null)}
          onBooked={async (message) => {
            setBooking(null);
            setNotice(message);
            await load();
          }}
        />
      )}

      <div
        role="tablist"
        aria-label="Follow-up lists"
        className="mb-4 flex flex-wrap gap-1.5 border-b border-surface-border pb-2.5"
      >
        {BUCKETS.map((b) => {
          const count = data?.counts[b.key];
          const active = b.key === bucket;
          return (
            <button
              key={b.key}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => {
                setBucket(b.key);
                setData(null);
                setNotice(null);
              }}
              className={`whitespace-nowrap rounded-lg px-3 py-2 text-[13px] font-semibold transition-colors duration-150 ${
                active
                  ? "bg-brand-green text-on-primary"
                  : "text-ink-500 hover:bg-surface-bg hover:text-ink-900"
              }`}
            >
              {b.label}
              {count !== undefined && (
                <span
                  className={`ml-2 rounded-full px-1.5 py-0.5 text-[10px] ${
                    active
                      ? "bg-white/25"
                      : b.key === "overdue" || b.key === "unbooked"
                        ? count > 0
                          ? "bg-priority-orange-tint text-priority-orange"
                          : "bg-surface-bg"
                        : "bg-surface-bg"
                  }`}
                >
                  {count}
                </span>
              )}
            </button>
          );
        })}
      </div>

      <Card title={meta.label} bodyClassName="p-0">
        <div>
          {bucket === "unbooked" ? (
            <UnbookedTable
              rows={(data?.results as FollowUpUnbookedRow[] | undefined) ?? null}
              empty={meta.empty}
              onBook={(row) =>
                setBooking({
                  admissionId: row.admission_id,
                  name: row.patient_name,
                  defaultReason: "POST_DISCHARGE",
                })
              }
            />
          ) : (
            <AppointmentTable
              rows={(data?.results as FollowUpAppointmentRow[] | undefined) ?? null}
              empty={meta.empty}
              showNoShow={bucket === "overdue"}
              busyId={busyId}
              onNoShow={markNoShow}
              onBookAgain={(row) =>
                setBooking({
                  patientId: row.patient_id,
                  name: row.patient_name,
                  defaultReason: bucket === "missed" ? "OUTREACH" : row.reason,
                })
              }
            />
          )}
        </div>
      </Card>
    </div>
  );
}

function AppointmentTable({
  rows,
  empty,
  showNoShow,
  busyId,
  onNoShow,
  onBookAgain,
}: {
  rows: FollowUpAppointmentRow[] | null;
  empty: string;
  showNoShow: boolean;
  busyId: string | null;
  onNoShow: (row: FollowUpAppointmentRow) => void;
  onBookAgain: (row: FollowUpAppointmentRow) => void;
}) {
  const controls = useTableControls(rows, {
    sorts: APPOINTMENT_SORTS,
    searchText: appointmentSearch,
  });
  return (
    <>
      <TableFilter
        controls={controls}
        label="Filter follow-ups"
        placeholder="Filter by name or reason…"
      />
      <div className="overflow-x-auto">
        <table className={`${TABLE} min-w-[820px]`} aria-label="Follow-up appointments">
          <thead>
            <tr>
              <SortHeader controls={controls} sortKey="client">
                Client
              </SortHeader>
              <SortHeader controls={controls} sortKey="when">
                When
              </SortHeader>
              <SortHeader controls={controls} sortKey="reason">
                Reason
              </SortHeader>
              <th className={TH}>Clinician</th>
              <th className={TH}>Booked</th>
              <th className={TH}>
                <span className="sr-only">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {!rows && <TableSkeletonRows columns={6} />}
            {controls.rows.length
              ? controls.rows.map((row) => (
                  <tr key={row.id}>
                    <td className={TD}>
                      <Link
                        className="font-semibold text-brand-green hover:underline"
                        to={clientRecordPath(row.patient_id, "snapshot")}
                      >
                        {row.patient_name}
                      </Link>
                      <div className="text-[11px] text-ink-500">{row.citramac_number}</div>
                    </td>
                    <td className={TD}>{formatDateTime(row.scheduled_for)}</td>
                    <td className={TD}>{row.reason_label || "—"}</td>
                    <td className={TD}>{row.provider_name || "—"}</td>
                    <td className={TD}>
                      <Tag tone={row.origin === "DISCHARGE" ? "brand" : "neutral"}>
                        {row.origin === "DISCHARGE"
                          ? "At discharge"
                          : row.origin === "CARE_PLAN"
                            ? "Care plan"
                            : "Manual"}
                      </Tag>
                    </td>
                    <td className={TD}>
                      <div className="flex flex-wrap gap-2">
                        {showNoShow && (
                          <button
                            type="button"
                            className={`${BTN_GHOST} ${BTN_SM}`}
                            disabled={busyId === row.id}
                            onClick={() => onNoShow(row)}
                          >
                            Mark no-show
                          </button>
                        )}
                        <button
                          type="button"
                          className={`${BTN_GHOST} ${BTN_SM}`}
                          onClick={() => onBookAgain(row)}
                        >
                          Book another
                        </button>
                        <Link className={`${BTN_GHOST} ${BTN_SM}`} to="/clinical/appointments">
                          Reschedule
                        </Link>
                      </div>
                    </td>
                  </tr>
                ))
              : rows && (
                  <tr>
                    <td colSpan={6}>
                      <EmptyState
                        title={rows.length === 0 ? empty : "No follow-ups match that filter"}
                      />
                    </td>
                  </tr>
                )}
          </tbody>
        </table>
      </div>
    </>
  );
}

function UnbookedTable({
  rows,
  empty,
  onBook,
}: {
  rows: FollowUpUnbookedRow[] | null;
  empty: string;
  onBook: (row: FollowUpUnbookedRow) => void;
}) {
  const controls = useTableControls(rows, { sorts: UNBOOKED_SORTS, searchText: unbookedSearch });
  return (
    <>
      <TableFilter controls={controls} label="Filter discharged clients" />
      <div className="overflow-x-auto">
        <table className={`${TABLE} min-w-[620px]`} aria-label="Discharged without follow-up">
          <thead>
            <tr>
              <SortHeader controls={controls} sortKey="client">
                Client
              </SortHeader>
              <SortHeader controls={controls} sortKey="discharged">
                Discharged
              </SortHeader>
              <SortHeader controls={controls} sortKey="waiting">
                Waiting
              </SortHeader>
              <th className={TH}>
                <span className="sr-only">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {!rows && <TableSkeletonRows columns={4} />}
            {controls.rows.length
              ? controls.rows.map((row) => (
                  <tr key={row.id}>
                    <td className={TD}>
                      <Link
                        className="font-semibold text-brand-green hover:underline"
                        to={clientRecordPath(row.patient_id, "snapshot")}
                      >
                        {row.patient_name}
                      </Link>
                      <div className="text-[11px] text-ink-500">{row.citramac_number}</div>
                    </td>
                    <td className={TD}>{formatDateTime(row.discharged_at)}</td>
                    <td className={TD}>
                      <Tag tone={row.days_since_discharge >= 7 ? "warn" : "neutral"}>
                        {row.days_since_discharge} days
                      </Tag>
                    </td>
                    <td className={TD}>
                      <button
                        type="button"
                        className={`${BTN} ${BTN_SM}`}
                        onClick={() => onBook(row)}
                      >
                        Book follow-up
                      </button>
                    </td>
                  </tr>
                ))
              : rows && (
                  <tr>
                    <td colSpan={4}>
                      <EmptyState
                        title={rows.length === 0 ? empty : "No one matches that filter"}
                      />
                    </td>
                  </tr>
                )}
          </tbody>
        </table>
      </div>
    </>
  );
}

function BookingForm({
  target,
  onCancel,
  onBooked,
}: {
  target: BookingTarget;
  onCancel: () => void;
  onBooked: (message: string) => Promise<void>;
}) {
  const { accessToken } = useAuth();
  const valueSets = useValueSets();
  const [client, setClient] = useState<{ id: string; name: string } | null>(
    target.patientId ? { id: target.patientId, name: target.name } : null,
  );
  const [query, setQuery] = useState("");
  const [matches, setMatches] = useState<RegistrationRow[] | null>(null);
  const [when, setWhen] = useState("");
  const [reason, setReason] = useState(target.defaultReason);
  const [mode, setMode] = useState("IN_PERSON");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Stable for this form: a retry after a network error never double-books.
  const requestId = useRef(newRequestId());

  const findClient = async () => {
    if (!accessToken || query.trim().length < 2) return;
    setError(null);
    try {
      setMatches((await searchRegistrations(accessToken, query.trim())).results);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't search clients.");
    }
  };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!accessToken) return;
    const patient = target.admissionId ? undefined : client?.id;
    if (!target.admissionId && !patient) {
      setError("Choose a client first.");
      return;
    }
    if (!when) {
      setError("Choose a date and time.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await bookFollowUp(accessToken, {
        patient,
        admission: target.admissionId,
        scheduled_for: new Date(when).toISOString(),
        reason,
        mode,
        notes,
        client_request_id: requestId.current,
      });
      await onBooked(`Follow-up booked for ${client?.name || target.name}.`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't book the follow-up.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card
      title={`Book follow-up${client?.name || target.name ? ` — ${client?.name || target.name}` : ""}`}
      className="mb-5"
    >
      <form onSubmit={submit} className="flex flex-col gap-4">
        {!target.admissionId && !target.patientId && (
          <div>
            <div className="flex flex-wrap items-end gap-2">
              <Field label="Find the client" htmlFor="fu-client" className="flex-1">
                <input
                  id="fu-client"
                  className={INPUT}
                  value={query}
                  placeholder="Name, phone, national ID or CITRAMAC ID"
                  onChange={(e) => setQuery(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      void findClient();
                    }
                  }}
                />
              </Field>
              <button type="button" className={BTN_GHOST} onClick={findClient}>
                Search
              </button>
            </div>
            {client && (
              <p className="mt-2 text-[13px] text-ink-900">
                Selected: <strong>{client.name}</strong>
              </p>
            )}
            {matches && (
              <ul className="mt-2 divide-y divide-surface-border rounded-lg border border-surface-border text-[13px]">
                {matches.length ? (
                  matches.slice(0, 6).map((m) => (
                    <li key={m.id} className="flex items-center justify-between gap-3 px-3 py-2">
                      <span>
                        {m.name} <span className="text-ink-500">· {m.citramac_number}</span>
                      </span>
                      <button
                        type="button"
                        className={`${BTN_GHOST} ${BTN_SM}`}
                        onClick={() => {
                          setClient({ id: m.id, name: m.name });
                          setMatches(null);
                        }}
                      >
                        Select
                      </button>
                    </li>
                  ))
                ) : (
                  <li className="px-3 py-2 text-ink-500">No matching client found.</li>
                )}
              </ul>
            )}
          </div>
        )}

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <Field label="Date and time" htmlFor="fu-when">
            <input
              id="fu-when"
              type="datetime-local"
              required
              className={INPUT}
              value={when}
              onChange={(e) => setWhen(e.target.value)}
            />
          </Field>
          <Field label="Reason" htmlFor="fu-reason">
            <SelectChoices
              id="fu-reason"
              required
              options={valueSets.options("follow-up-reason")}
              value={reason}
              onChange={setReason}
            />
          </Field>
          <Field label="How" htmlFor="fu-mode">
            <select
              id="fu-mode"
              className={INPUT}
              value={mode}
              onChange={(e) => setMode(e.target.value)}
            >
              <option value="IN_PERSON">In person</option>
              <option value="PHONE">Phone</option>
              <option value="VIDEO">Video</option>
            </select>
          </Field>
        </div>
        <Field label="Notes (optional)" htmlFor="fu-notes">
          <input
            id="fu-notes"
            className={INPUT}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
          />
        </Field>
        {valueSets.error && <ErrorNote>{valueSets.error}</ErrorNote>}
        {error && <ErrorNote>{error}</ErrorNote>}
        <div className="flex gap-2">
          <button type="submit" className={BTN} disabled={busy}>
            {busy ? "Booking…" : "Book follow-up"}
          </button>
          <button type="button" className={BTN_GHOST} onClick={onCancel}>
            Cancel
          </button>
        </div>
      </form>
    </Card>
  );
}
