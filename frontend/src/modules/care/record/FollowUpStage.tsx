import { useState } from "react";
import { Link } from "react-router-dom";
import { listAppointments, type AppointmentStatus } from "../../../lib/appointmentsApi";
import { getClientFollowUps } from "../../../lib/carePlanOutcomesApi";
import { formatDate, formatTime } from "../shared/format";
import { BTN_GHOST, TABLE, TD, TH } from "../shared/styles";
import { Card, ErrorNote, PageHeader, Tag } from "../shared/ui";
import { FollowUpPanel } from "./outcomes/FollowUpPanel";
import type { RecordViewProps } from "./types";
import { useRecordData } from "./useRecordData";

const STATUS_LABEL: Record<AppointmentStatus, string> = {
  SCHEDULED: "Scheduled",
  CHECKED_IN: "Checked in",
  COMPLETED: "Completed",
  CANCELLED: "Cancelled",
  NO_SHOW: "No show",
};

/** Follow-up — mockup v4 stage 6 follow-up: the same follow-ups as the
 * worklist, actioned in the record; every other appointment listed below. */
export function FollowUpStage({ patientId, banner, onRecordChanged }: RecordViewProps) {
  const [version, setVersion] = useState(0);
  const followUps = useRecordData(
    patientId,
    version,
    (token) => getClientFollowUps(token, patientId),
    "Couldn't load this client's follow-up.",
  );
  const { data, error, loading } = useRecordData(
    patientId,
    version,
    (token) => listAppointments(token, { patient: patientId }),
    "Couldn't load this client's appointments.",
  );
  const rows = [...(data?.results ?? [])].sort(
    (a, b) => new Date(a.scheduled_for).getTime() - new Date(b.scheduled_for).getTime(),
  );
  const name = banner.name.trim() || "Temporary client (unnamed)";

  return (
    <div>
      <PageHeader
        title="Follow-up"
        subtitle={`Plan and review ongoing care for ${name}`}
        actions={
          <Link to="/clinical/appointments" className={BTN_GHOST}>
            Schedule Appointment
          </Link>
        }
      />
      <ErrorNote>{followUps.error ?? error}</ErrorNote>
      <Card title="Follow-up" className="mt-3">
        <FollowUpPanel
          patientId={patientId}
          clientName={name}
          data={followUps.data}
          onChanged={() => {
            setVersion((v) => v + 1);
            onRecordChanged();
          }}
        />
      </Card>
      <Card title="All appointments" bodyClassName="p-0" className="mt-3">
        <div className="overflow-x-auto">
          <table className={`${TABLE} min-w-[560px]`}>
            <thead>
              <tr>
                <th className={TH}>Date</th>
                <th className={TH}>Time</th>
                <th className={TH}>Type</th>
                <th className={TH}>Provider</th>
                <th className={TH}>Status</th>
              </tr>
            </thead>
            <tbody>
              {rows.length > 0 ? (
                rows.map((a) => (
                  <tr key={a.id}>
                    <td className={`${TD} whitespace-nowrap`}>{formatDate(a.scheduled_for)}</td>
                    <td className={`${TD} whitespace-nowrap`}>{formatTime(a.scheduled_for)}</td>
                    <td className={TD}>{a.appointment_type || "Appointment"}</td>
                    <td className={TD}>{a.provider_name || "Not assigned"}</td>
                    <td className={TD}>
                      <Tag>{STATUS_LABEL[a.status] ?? a.status}</Tag>
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={5} className={`${TD} py-6 text-center text-ink-500`}>
                    {loading && !data
                      ? "Loading appointments…"
                      : "No follow-up appointments are currently scheduled for this client."}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
