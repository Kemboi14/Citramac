import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../../auth/useAuth";
import { ApiError } from "../../lib/apiClient";
import { getClientVitals, type VitalRow } from "../../lib/carePathwayApi";
import {
  listAllBeds,
  listAllWards,
  listCurrentAdmissions,
  listNursingNotes,
  type Admission,
  type Bed,
  type BedStatus,
  type NursingNote,
  type Ward,
} from "../../lib/ipdApi";
import { formatDateTime } from "./shared/format";
import { clientRecordPath } from "./shared/recordRoutes";
import { BTN_GHOST, TABLE, TD, TH } from "./shared/styles";
import { Callout, Card, ErrorNote, PageHeader } from "./shared/ui";

// Ward Board — mockup `ward()`, docs/15-CLINICAL-WORKSPACE-V3.md §1.17.
// Bed grid per ward; selecting an occupied bed shows that admission's nursing
// notes and the client's recent observations. Nothing is held in browser storage.

const STATUS_LABEL: Record<BedStatus, string> = {
  OCCUPIED: "Occupied",
  AVAILABLE: "Available",
  RESERVED: "Reserved",
  MAINTENANCE: "Maintenance",
};

// `.bed-card.occupied / .reserved / .available` (maintenance renders plain, as available).
const CARD_TONE: Record<BedStatus, string> = {
  OCCUPIED: "border-brand-green bg-brand-green-tint",
  RESERVED: "border-priority-orange bg-priority-orange-tint",
  AVAILABLE: "border-surface-border bg-surface-card",
  MAINTENANCE: "border-surface-border bg-surface-card",
};
const STATUS_TONE: Record<BedStatus, string> = {
  OCCUPIED: "text-brand-green",
  RESERVED: "text-priority-orange",
  AVAILABLE: "text-ink-500",
  MAINTENANCE: "text-ink-500",
};

const BED_CARD = "rounded-lg border-2 px-2 py-3 text-center transition-colors duration-150";

interface BoardData {
  wards: Ward[];
  beds: Bed[];
  admissions: Admission[];
}

export function WardBoardPage() {
  const { accessToken } = useAuth();
  const navigate = useNavigate();
  const [data, setData] = useState<BoardData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [chosenWardId, setChosenWardId] = useState<string | null>(null);
  const [selectedBedId, setSelectedBedId] = useState<string | null>(null);

  useEffect(() => {
    if (!accessToken) return;
    let cancelled = false;
    Promise.all([
      listAllWards(accessToken),
      listAllBeds(accessToken),
      listCurrentAdmissions(accessToken),
    ])
      .then(([wards, beds, admissions]) => !cancelled && setData({ wards, beds, admissions }))
      .catch(
        (err) =>
          !cancelled &&
          setError(err instanceof ApiError ? err.message : "Couldn't load the ward board."),
      );
    return () => {
      cancelled = true;
    };
  }, [accessToken]);

  const wards = data?.wards ?? [];
  const ward = wards.find((w) => w.id === chosenWardId) ?? wards[0];
  const beds = (data?.beds ?? []).filter((b) => b.ward === ward?.id);
  const admissionByBed = new Map((data?.admissions ?? []).map((a) => [a.bed, a]));
  const selectedBed = beds.find((b) => b.id === selectedBedId);
  const selectedAdmission = selectedBed ? admissionByBed.get(selectedBed.id) : undefined;

  const switchWard = (wardId: string) => {
    setChosenWardId(wardId);
    setSelectedBedId(null);
  };

  return (
    <div className="flex animate-fade-in flex-col gap-5">
      <PageHeader
        title={`Ward Board — ${ward?.name ?? (data ? "No wards" : "Loading…")}`}
        subtitle="Bed management and patient overview"
        actions={
          <>
            {wards
              .filter((w) => w.id !== ward?.id)
              .map((w) => (
                <button
                  key={w.id}
                  type="button"
                  className={BTN_GHOST}
                  onClick={() => switchWard(w.id)}
                >
                  {w.name}
                </button>
              ))}
            <button
              type="button"
              className={BTN_GHOST}
              onClick={() => navigate("/clinical/ipd/nursing")}
            >
              Nursing Notes
            </button>
            <button
              type="button"
              className={BTN_GHOST}
              disabled={!selectedAdmission}
              title={selectedAdmission ? undefined : "Select an occupied bed first"}
              onClick={() =>
                selectedAdmission &&
                navigate(clientRecordPath(selectedAdmission.patient, "snapshot"))
              }
            >
              Ward Round
            </button>
          </>
        }
      />

      <ErrorNote>{error}</ErrorNote>

      {data && wards.length === 0 && <Callout>No wards are set up for this facility yet.</Callout>}
      {ward && beds.length === 0 && <Callout>{ward.name} has no beds set up yet.</Callout>}

      {beds.length > 0 && (
        <div
          className="grid grid-cols-2 gap-2.5 min-[481px]:grid-cols-3 min-[769px]:grid-cols-4"
          role="list"
          aria-label={`Beds in ${ward?.name ?? "ward"}`}
        >
          {beds.map((bed) => {
            const admission = admissionByBed.get(bed.id);
            const occupant = admission?.patient_name || bed.occupant_name || "—";
            const content = (
              <>
                <div className="text-[11px] font-bold uppercase text-ink-500">
                  Bed {bed.bed_number}
                </div>
                <div className={`mt-1 text-xs font-semibold ${STATUS_TONE[bed.status]}`}>
                  {STATUS_LABEL[bed.status]}
                </div>
                <div className="mt-0.5 truncate text-[11px] text-ink-500">{occupant}</div>
              </>
            );
            const tone = CARD_TONE[bed.status];
            if (bed.status === "OCCUPIED" && admission) {
              const selected = bed.id === selectedBedId;
              return (
                <div role="listitem" key={bed.id}>
                  <button
                    type="button"
                    aria-pressed={selected}
                    aria-label={`Bed ${bed.bed_number}, occupied by ${occupant}`}
                    onClick={() => setSelectedBedId(bed.id)}
                    className={`${BED_CARD} ${tone} w-full hover:border-brand-green ${
                      selected ? "ring-2 ring-brand-green ring-offset-2 ring-offset-surface-bg" : ""
                    }`}
                  >
                    {content}
                  </button>
                </div>
              );
            }
            return (
              <div
                role="listitem"
                key={bed.id}
                className={`${BED_CARD} ${tone} hover:border-brand-green`}
              >
                {content}
              </div>
            );
          })}
        </div>
      )}

      {beds.length > 0 && !selectedAdmission && (
        <Callout>Select an occupied bed to see its nursing notes and observations.</Callout>
      )}

      {selectedBed && selectedAdmission && (
        <SelectedBedPanels
          key={selectedAdmission.id}
          bed={selectedBed}
          admission={selectedAdmission}
        />
      )}
    </div>
  );
}

function SelectedBedPanels({ bed, admission }: { bed: Bed; admission: Admission }) {
  const { accessToken } = useAuth();
  const [notes, setNotes] = useState<NursingNote[] | null>(null);
  const [notesError, setNotesError] = useState<string | null>(null);
  const [vitals, setVitals] = useState<VitalRow[] | null>(null);
  const [vitalsError, setVitalsError] = useState<string | null>(null);

  useEffect(() => {
    if (!accessToken) return;
    let cancelled = false;
    listNursingNotes(accessToken, admission.id)
      .then(
        (res) =>
          !cancelled &&
          setNotes([...res.results].sort((a, b) => a.recorded_at.localeCompare(b.recorded_at))),
      )
      .catch(
        (err) =>
          !cancelled &&
          setNotesError(err instanceof ApiError ? err.message : "Couldn't load nursing notes."),
      );
    getClientVitals(accessToken, admission.patient)
      .then((res) => {
        if (cancelled) return;
        const latest = [...res.results]
          .sort((a, b) => b.recorded_at.localeCompare(a.recorded_at))
          .slice(0, 10)
          .reverse();
        setVitals(latest);
      })
      .catch(
        (err) =>
          !cancelled &&
          setVitalsError(err instanceof ApiError ? err.message : "Couldn't load observations."),
      );
    return () => {
      cancelled = true;
    };
  }, [accessToken, admission.id, admission.patient]);

  const authorName = (note: NursingNote) => {
    const shift = note.shift === "NIGHT" ? "Night shift" : "Day shift";
    const name = note.author_name.trim();
    return name ? `${name} · ${shift}` : shift;
  };

  const dash = (value: string | number | null) =>
    value === null || value === "" ? "—" : String(value);

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
      <Card title={`Nursing Notes — Bed ${bed.bed_number} (${admission.patient_name})`}>
        <ErrorNote>{notesError}</ErrorNote>
        {!notes && !notesError && <p className="text-[13px] text-ink-500">Loading…</p>}
        {notes && notes.length === 0 && (
          <p className="text-[13px] text-ink-500">No nursing notes recorded for this admission.</p>
        )}
        {notes && notes.length > 0 && (
          <div className="flex flex-col gap-2">
            {notes.map((note) => (
              <article
                key={note.id}
                className="rounded-lg border border-surface-border bg-surface-bg px-3.5 py-3"
              >
                <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
                  <span className="text-xs font-semibold text-ink-900">{authorName(note)}</span>
                  <span className="font-mono text-[11px] text-ink-400">
                    {formatDateTime(note.recorded_at)}
                  </span>
                </div>
                <p className="whitespace-pre-line text-[12.5px] text-ink-500">{note.note}</p>
              </article>
            ))}
          </div>
        )}
      </Card>
      <Card title={`Observations — Bed ${bed.bed_number}`} bodyClassName="p-0">
        {vitalsError && (
          <div className="p-[18px]">
            <ErrorNote>{vitalsError}</ErrorNote>
          </div>
        )}
        <div className="overflow-x-auto">
          <table className={TABLE}>
            <thead>
              <tr>
                <th className={TH}>Time</th>
                <th className={TH}>BP</th>
                <th className={TH}>HR</th>
                <th className={TH}>Temp</th>
                <th className={TH}>SpO2</th>
              </tr>
            </thead>
            <tbody>
              {!vitals && !vitalsError && (
                <tr>
                  <td colSpan={5} className={`${TD} text-center text-ink-500`}>
                    Loading…
                  </td>
                </tr>
              )}
              {vitals && vitals.length === 0 && (
                <tr>
                  <td colSpan={5} className={`${TD} py-6 text-center text-ink-500`}>
                    No observations recorded for this client.
                  </td>
                </tr>
              )}
              {vitals?.map((row) => (
                <tr key={row.id} className="hover:bg-surface-bg">
                  <td className={`${TD} whitespace-nowrap`}>{formatDateTime(row.recorded_at)}</td>
                  <td className={TD}>
                    {row.systolic_bp !== null && row.diastolic_bp !== null
                      ? `${row.systolic_bp}/${row.diastolic_bp}`
                      : "—"}
                  </td>
                  <td className={TD}>{dash(row.heart_rate)}</td>
                  <td className={TD}>
                    {row.temperature_c !== null && row.temperature_c !== ""
                      ? `${row.temperature_c}°C`
                      : "—"}
                  </td>
                  <td className={TD}>{row.spo2 !== null ? `${row.spo2}%` : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
