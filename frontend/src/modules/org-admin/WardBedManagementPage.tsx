import { useEffect, useState } from "react";
import { BedDouble, Plus } from "lucide-react";
import { useAuth } from "../../auth/useAuth";
import { ApiError } from "../../lib/apiClient";
import { listBranches, type Branch } from "../../lib/branchesApi";
import {
  createBed,
  createWard,
  getWardSummary,
  listBeds,
  updateBed,
  type Bed,
  type BedStatus,
  type WardBedSummary,
} from "../../lib/ipdApi";

const CARD_CLASS = "rounded-lg border border-surface-border bg-surface-card p-6 shadow-sm";
const FIELD_CLASS =
  "rounded-sm border border-surface-border px-3 py-2 text-sm text-ink-900 outline-none transition-colors duration-150 focus:border-brand-green";
const LABEL_CLASS = "flex flex-col gap-1.5 text-sm font-medium text-ink-700";
const BUTTON_CLASS =
  "inline-flex items-center gap-1.5 rounded-md bg-brand-green px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-brand-green-dark active:scale-[0.98] disabled:opacity-60 disabled:active:scale-100 transition-all duration-150";

const STATUS_LEGEND: { key: BedStatus; label: string; dot: string }[] = [
  { key: "AVAILABLE", label: "Vacant", dot: "bg-brand-green" },
  { key: "OCCUPIED", label: "Occupied", dot: "bg-ink-400" },
  { key: "RESERVED", label: "Reserved", dot: "bg-status-amber" },
  { key: "MAINTENANCE", label: "Under Maintenance", dot: "bg-status-red" },
];

const BED_STATUSES: BedStatus[] = ["AVAILABLE", "OCCUPIED", "RESERVED", "MAINTENANCE"];

const BED_TILE_CLASS: Record<BedStatus, string> = {
  AVAILABLE: "bg-brand-green-tint text-brand-green-dark",
  OCCUPIED: "bg-surface-card border border-surface-border text-ink-900",
  RESERVED: "bg-status-amber-tint text-status-amber",
  MAINTENANCE: "bg-status-red-tint text-status-red",
};

const STATUS_LABEL: Record<BedStatus, string> = {
  AVAILABLE: "Vacant",
  OCCUPIED: "Occupied",
  RESERVED: "Reserved",
  MAINTENANCE: "Maintenance",
};

/**
 * Org Admin ward & bed management — create wards, set capacity, and track
 * live bed status for ward rounds.
 */
export function WardBedManagementPage() {
  const { accessToken } = useAuth();
  const [branch, setBranch] = useState<Branch | null>(null);
  const [summary, setSummary] = useState<WardBedSummary | null>(null);
  const [selectedWardId, setSelectedWardId] = useState<string | null>(null);
  const [beds, setBeds] = useState<Bed[]>([]);

  const [loading, setLoading] = useState(true);
  const [bedsLoading, setBedsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [showWardForm, setShowWardForm] = useState(false);
  const [wardName, setWardName] = useState("");
  const [wardType, setWardType] = useState("");

  const [bedNumber, setBedNumber] = useState("");

  const refreshSummary = async (branchId: string) => {
    if (!accessToken) return;
    const result = await getWardSummary(accessToken, branchId);
    setSummary(result);
    setSelectedWardId((current) => {
      if (current && result.wards.some((w) => w.id === current)) return current;
      return result.wards[0]?.id ?? null;
    });
    return result;
  };

  useEffect(() => {
    if (!accessToken) return;
    void Promise.resolve().then(() => {
      setError(null);
      return listBranches(accessToken)
        .then(async (res) => {
          const homeBranch = res.results[0] ?? null;
          setBranch(homeBranch);
          if (homeBranch) {
            await refreshSummary(homeBranch.id);
          }
        })
        .catch((err) => setError(err instanceof ApiError ? err.message : "Couldn't load wards."))
        .finally(() => setLoading(false));
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accessToken]);

  const refreshBeds = async (wardId: string) => {
    if (!accessToken) return;
    setBedsLoading(true);
    try {
      const res = await listBeds(accessToken, wardId);
      setBeds(res.results);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't load beds.");
    } finally {
      setBedsLoading(false);
    }
  };

  useEffect(() => {
    if (!selectedWardId) {
      // Local-state reset on selection change, not an external sync.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setBeds([]);
      return;
    }
    refreshBeds(selectedWardId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedWardId, accessToken]);

  const submitWard = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!accessToken || !branch || !wardName.trim()) return;
    setError(null);
    setBusy(true);
    try {
      await createWard(accessToken, {
        name: wardName.trim(),
        branch: branch.id,
        ward_type: wardType.trim() || undefined,
      });
      setWardName("");
      setWardType("");
      setShowWardForm(false);
      await refreshSummary(branch.id);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't create the ward.");
    } finally {
      setBusy(false);
    }
  };

  const submitBed = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!accessToken || !selectedWardId || !bedNumber.trim()) return;
    setError(null);
    setBusy(true);
    try {
      await createBed(accessToken, { ward: selectedWardId, bed_number: bedNumber.trim() });
      setBedNumber("");
      await Promise.all([refreshBeds(selectedWardId), branch && refreshSummary(branch.id)]);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't create the bed.");
    } finally {
      setBusy(false);
    }
  };

  const changeBedStatus = async (bed: Bed, status: BedStatus) => {
    if (!accessToken || status === bed.status) return;
    setError(null);
    setBusy(true);
    try {
      await updateBed(accessToken, bed.id, { status });
      if (selectedWardId) await refreshBeds(selectedWardId);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't update the bed.");
    } finally {
      setBusy(false);
    }
  };

  const selectedWard = summary?.wards.find((w) => w.id === selectedWardId) ?? null;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <div>
          <div className="mb-1.5 text-[11px] font-bold uppercase tracking-wide text-brand-green">
            Inpatient Operations
          </div>
          <h1 className="font-display text-2xl font-bold text-ink-900">Wards & Beds</h1>
        </div>
      </div>

      {loading && <p className="text-sm text-ink-500">Loading…</p>}

      {error && (
        <p className="rounded-sm bg-status-red-tint px-3 py-2 text-sm text-status-red">{error}</p>
      )}

      {!loading && !branch && (
        <p className="text-sm text-ink-500">No branch found for your organization.</p>
      )}

      {summary && branch && (
        <>
          <div className={`${CARD_CLASS} flex flex-wrap items-center gap-6`}>
            {STATUS_LEGEND.map((item) => (
              <div key={item.key} className="flex items-center gap-2 text-sm text-ink-700">
                <span className={`h-2.5 w-2.5 rounded-full ${item.dot}`} />
                <span className="font-medium text-ink-900">
                  {summary.beds_by_status[item.key] ?? 0}
                </span>
                <span>{item.label}</span>
              </div>
            ))}
          </div>

          <div className={CARD_CLASS}>
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
              <h2 className="font-display text-base font-semibold text-ink-900">Wards</h2>
              <button
                type="button"
                className={BUTTON_CLASS}
                onClick={() => setShowWardForm((v) => !v)}
              >
                <Plus size={14} />
                Add Ward
              </button>
            </div>

            {showWardForm && (
              <form onSubmit={submitWard} className="mb-4 flex flex-wrap items-end gap-3">
                <label className={LABEL_CLASS}>
                  Ward Name
                  <input
                    className={FIELD_CLASS}
                    value={wardName}
                    onChange={(e) => setWardName(e.target.value)}
                    placeholder="e.g. Maternity Ward"
                    required
                  />
                </label>
                <label className={LABEL_CLASS}>
                  Ward Type (optional)
                  <input
                    className={FIELD_CLASS}
                    value={wardType}
                    onChange={(e) => setWardType(e.target.value)}
                    placeholder="e.g. MATERNITY"
                  />
                </label>
                <button type="submit" disabled={busy} className={BUTTON_CLASS}>
                  Save Ward
                </button>
              </form>
            )}

            {summary.wards.length === 0 ? (
              <p className="text-sm text-ink-500">No wards yet — add one to get started.</p>
            ) : (
              <div className="flex flex-wrap gap-2">
                {summary.wards.map((ward) => (
                  <button
                    key={ward.id}
                    type="button"
                    onClick={() => setSelectedWardId(ward.id)}
                    className={`rounded-md px-3 py-1.5 text-sm font-medium ${
                      ward.id === selectedWardId
                        ? "bg-brand-green text-white"
                        : "bg-surface-bg text-ink-700 hover:bg-brand-green-tint"
                    }`}
                  >
                    {ward.name} · {ward.bed_count} beds
                  </button>
                ))}
              </div>
            )}
          </div>

          {selectedWard && (
            <div className={CARD_CLASS}>
              <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                <h2 className="font-display text-base font-semibold text-ink-900">
                  {selectedWard.name} · Beds
                </h2>
                <form onSubmit={submitBed} className="flex items-end gap-2">
                  <label className={LABEL_CLASS}>
                    Bed Number
                    <input
                      className={FIELD_CLASS}
                      value={bedNumber}
                      onChange={(e) => setBedNumber(e.target.value)}
                      placeholder="e.g. B-12"
                      required
                    />
                  </label>
                  <button type="submit" disabled={busy} className={BUTTON_CLASS}>
                    <Plus size={14} />
                    Add Bed
                  </button>
                </form>
              </div>

              {bedsLoading && <p className="text-sm text-ink-500">Loading beds…</p>}

              {!bedsLoading && beds.length === 0 && (
                <p className="text-sm text-ink-500">No beds in this ward yet.</p>
              )}

              {!bedsLoading && beds.length > 0 && (
                <div className="grid grid-cols-[repeat(auto-fill,minmax(90px,1fr))] gap-3">
                  {beds.map((bed) => (
                    <div
                      key={bed.id}
                      className={`flex flex-col gap-1 rounded-md p-3 text-xs ${BED_TILE_CLASS[bed.status]}`}
                    >
                      <div className="flex items-center gap-1.5 font-display text-sm font-bold">
                        <BedDouble size={14} />
                        {bed.bed_number}
                      </div>
                      <div className="font-medium">{STATUS_LABEL[bed.status]}</div>
                      {bed.status === "OCCUPIED" && bed.occupant_name && (
                        <div className="truncate" title={bed.occupant_name}>
                          {bed.occupant_name}
                        </div>
                      )}
                      <select
                        className="mt-1 rounded-sm border border-surface-border bg-surface-card px-1 py-0.5 text-[11px] text-ink-900 outline-none"
                        value={bed.status}
                        disabled={busy}
                        onChange={(e) => changeBedStatus(bed, e.target.value as BedStatus)}
                      >
                        {BED_STATUSES.map((status) => (
                          <option key={status} value={status}>
                            {/* eslint-disable-next-line security/detect-object-injection -- `status` is iterated from the fixed `BED_STATUSES` const array, not user input. */}
                            {STATUS_LABEL[status]}
                          </option>
                        ))}
                      </select>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
