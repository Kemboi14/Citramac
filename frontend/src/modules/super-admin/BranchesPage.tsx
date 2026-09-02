import { useEffect, useMemo, useState } from "react";
import { BedDouble, Building2, Landmark, Plus, Search, ShieldCheck } from "lucide-react";
import { useAuth } from "../../auth/useAuth";
import { ApiError } from "../../lib/apiClient";
import {
  createBranch,
  listBranches,
  updateBranch,
  type Branch,
  type CcpRegistrationStatus,
} from "../../lib/branchesApi";
import { listOrganizations, type Organization } from "../../lib/organizationsApi";
import { StatCard } from "../../components/StatCard";
import { Drawer } from "../../components/Drawer";

const FIELD_CLASS =
  "rounded-sm border border-surface-border px-3 py-2 text-sm text-ink-900 outline-none transition-colors duration-150 focus:border-brand-green";
const LABEL_CLASS = "flex flex-col gap-1.5 text-sm font-medium text-ink-700";
const BUTTON_CLASS =
  "inline-flex items-center gap-2 rounded-md bg-brand-green px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-brand-green-dark active:scale-[0.98] disabled:opacity-60 disabled:active:scale-100 transition-all duration-150";

const CCP_TINT: Record<CcpRegistrationStatus, string> = {
  OPEN: "bg-brand-green-tint text-brand-green-dark",
  WAITLIST: "bg-status-amber-tint text-status-amber",
  CLOSED: "bg-status-red-tint text-status-red",
};

const FACILITY_LEVEL_OPTIONS = [
  { value: "L2", label: "Level 2 — Dispensary" },
  { value: "L3", label: "Level 3 — Health Centre" },
  { value: "L4", label: "Level 4 — Sub-County Hospital" },
  { value: "L5", label: "Level 5 — County Hospital" },
  { value: "L6", label: "Level 6 — National Referral" },
];

function facilityLevelShort(level: string) {
  return `Level ${level.replace(/^L/, "")}`;
}

type StatusFilter = "all" | "active" | "ccp" | "inactive";

const STATUS_FILTERS: { label: string; value: StatusFilter }[] = [
  { label: "All", value: "all" },
  { label: "Active", value: "active" },
  { label: "CCP-Registered", value: "ccp" },
  { label: "Inactive", value: "inactive" },
];

interface NewBranchState {
  organization: string;
  name: string;
  mfl_code: string;
  facility_level: string;
  address: string;
  county: string;
  sub_county: string;
  outpatient_capacity_per_day: string;
  ccp_open: boolean;
  is_active: boolean;
}

const EMPTY_NEW_BRANCH: NewBranchState = {
  organization: "",
  name: "",
  mfl_code: "",
  facility_level: "L4",
  address: "",
  county: "",
  sub_county: "",
  outpatient_capacity_per_day: "",
  ccp_open: false,
  is_active: true,
};

/**
 * Super Admin — Branches. Every physical facility across every tenant
 * organization on the platform; the backend already scopes the JWT to see
 * everything so this page simply renders what comes back.
 *
 * Search + status chips filter the already-fetched page client-side, mirroring
 * the mockup's own `filterBranchTable()` behaviour — the backend's `q` param
 * only matches name/MFL code (see BranchViewSet.get_queryset), not
 * organization name, and there's no `is_active` query param at all, so a
 * single client-side filter over one fetch covers name + org + MFL code +
 * active/CCP status without extra round-trips.
 */
export function BranchesPage() {
  const { accessToken } = useAuth();
  const [branches, setBranches] = useState<Branch[]>([]);
  const [organizations, setOrganizations] = useState<Organization[]>([]);
  const [count, setCount] = useState(0);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [newBranch, setNewBranch] = useState<NewBranchState>(EMPTY_NEW_BRANCH);

  const refresh = async () => {
    if (!accessToken) return;
    setLoading(true);
    setError(null);
    try {
      const res = await listBranches(accessToken);
      setBranches(res.results);
      setCount(res.count);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't load branches.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!accessToken) return;
    // Deferred one microtask so `refresh`'s own setLoading(true) runs inside
    // a callback rather than synchronously in the effect body.
    void Promise.resolve().then(() => refresh());
    listOrganizations(accessToken)
      .then((res) => setOrganizations(res.results))
      .catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accessToken]);

  const filteredBranches = useMemo(() => {
    const q = search.trim().toLowerCase();
    return branches.filter((b) => {
      if (q) {
        const haystack = `${b.name} ${b.organization_name} ${b.mfl_code}`.toLowerCase();
        if (!haystack.includes(q)) return false;
      }
      if (statusFilter === "active") return b.is_active;
      if (statusFilter === "inactive") return !b.is_active;
      if (statusFilter === "ccp") return b.ccp_registration_status === "OPEN";
      return true;
    });
  }, [branches, search, statusFilter]);

  const openForm = () => {
    setFormError(null);
    setNewBranch(EMPTY_NEW_BRANCH);
    setShowForm(true);
  };

  const submitNewBranch = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!accessToken || !newBranch.organization || !newBranch.name) return;
    setFormError(null);
    setBusy(true);
    try {
      await createBranch(accessToken, {
        organization: newBranch.organization,
        name: newBranch.name,
        mfl_code: newBranch.mfl_code || undefined,
        facility_level: newBranch.facility_level,
        address: newBranch.address || undefined,
        county: newBranch.county || undefined,
        sub_county: newBranch.sub_county || undefined,
        outpatient_capacity_per_day: newBranch.outpatient_capacity_per_day
          ? Number(newBranch.outpatient_capacity_per_day)
          : undefined,
        ccp_registration_status: newBranch.ccp_open ? "OPEN" : "CLOSED",
        is_active: newBranch.is_active,
      });
      setShowForm(false);
      setNewBranch(EMPTY_NEW_BRANCH);
      await refresh();
    } catch (err) {
      setFormError(err instanceof ApiError ? err.message : "Couldn't create the branch.");
    } finally {
      setBusy(false);
    }
  };

  const toggleActive = async (branch: Branch) => {
    if (!accessToken) return;
    setBusyId(branch.id);
    setError(null);
    try {
      await updateBranch(accessToken, branch.id, { is_active: !branch.is_active });
      await refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't update the branch status.");
    } finally {
      setBusyId(null);
    }
  };

  const totalBranches = count || branches.length;
  const totalWards = branches.reduce((sum, b) => sum + (b.ward_count ?? 0), 0);
  const totalBeds = branches.reduce((sum, b) => sum + (b.bed_count ?? 0), 0);
  const ccpOpenCount = branches.filter((b) => b.ccp_registration_status === "OPEN").length;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="mb-1.5 text-[11px] font-bold uppercase tracking-wide text-brand-green">
            Platform · Facilities
          </div>
          <h1 className="font-display text-2xl font-bold text-ink-900">Branches</h1>
        </div>
        <button type="button" className={BUTTON_CLASS} onClick={openForm}>
          <Plus className="h-4 w-4" />
          Add Branch
        </button>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard icon={Landmark} value={totalBranches} label="Total Branches" />
        <StatCard icon={Building2} value={totalWards} label="Wards Registered" />
        <StatCard icon={BedDouble} value={totalBeds} label="Beds Across Platform" />
        <StatCard
          icon={ShieldCheck}
          tone="amber"
          value={ccpOpenCount}
          label="CCP-Registered Branches"
        />
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-400" />
          <input
            className={`${FIELD_CLASS} w-72 pl-9`}
            placeholder="Search by branch, org, or MFL code…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <div className="flex gap-2">
          {STATUS_FILTERS.map((filter) => (
            <button
              key={filter.value}
              type="button"
              onClick={() => setStatusFilter(filter.value)}
              className={`rounded-full px-3 py-1.5 text-xs font-semibold ${
                statusFilter === filter.value
                  ? "bg-brand-green text-white"
                  : "border border-surface-border text-ink-700 hover:bg-surface-bg"
              }`}
            >
              {filter.label}
            </button>
          ))}
        </div>
      </div>

      <form onSubmit={submitNewBranch}>
        <Drawer
          open={showForm}
          title="Add Branch"
          subtitle="Register a new facility under an organization"
          onClose={() => setShowForm(false)}
          footer={
            <>
              <button
                type="button"
                className="flex-1 rounded-md border border-surface-border px-4 py-2 text-sm font-semibold text-ink-700 hover:bg-surface-bg"
                onClick={() => setShowForm(false)}
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={busy}
                className={`${BUTTON_CLASS} flex-1 justify-center`}
              >
                {busy ? "Creating…" : "Create Branch"}
              </button>
            </>
          }
        >
          <div className="flex flex-col gap-4">
            <label className={LABEL_CLASS}>
              Parent Organization <span className="text-status-red">*</span>
              <select
                className={FIELD_CLASS}
                value={newBranch.organization}
                onChange={(e) => setNewBranch({ ...newBranch, organization: e.target.value })}
                required
              >
                <option value="">Select an organization…</option>
                {organizations.map((org) => (
                  <option key={org.id} value={org.id}>
                    {org.name}
                  </option>
                ))}
              </select>
            </label>
            <label className={LABEL_CLASS}>
              Branch Name <span className="text-status-red">*</span>
              <input
                className={FIELD_CLASS}
                value={newBranch.name}
                onChange={(e) => setNewBranch({ ...newBranch, name: e.target.value })}
                placeholder="e.g. Rehab Wing"
                required
              />
            </label>
            <label className={LABEL_CLASS}>
              Branch DHA MFL Code
              <input
                className={FIELD_CLASS}
                value={newBranch.mfl_code}
                onChange={(e) => setNewBranch({ ...newBranch, mfl_code: e.target.value })}
                placeholder="e.g. MFL-14238-B2"
              />
            </label>
            <label className={LABEL_CLASS}>
              Facility Level <span className="text-status-red">*</span>
              <select
                className={FIELD_CLASS}
                value={newBranch.facility_level}
                onChange={(e) => setNewBranch({ ...newBranch, facility_level: e.target.value })}
              >
                {FACILITY_LEVEL_OPTIONS.map((level) => (
                  <option key={level.value} value={level.value}>
                    {level.label}
                  </option>
                ))}
              </select>
            </label>
            <label className={LABEL_CLASS}>
              Address
              <input
                className={FIELD_CLASS}
                value={newBranch.address}
                onChange={(e) => setNewBranch({ ...newBranch, address: e.target.value })}
                placeholder="e.g. Waiyaki Way, Westlands"
              />
            </label>
            <div className="grid grid-cols-2 gap-3">
              <label className={LABEL_CLASS}>
                County
                <input
                  className={FIELD_CLASS}
                  value={newBranch.county}
                  onChange={(e) => setNewBranch({ ...newBranch, county: e.target.value })}
                  placeholder="e.g. Nairobi"
                />
              </label>
              <label className={LABEL_CLASS}>
                Sub-County
                <input
                  className={FIELD_CLASS}
                  value={newBranch.sub_county}
                  onChange={(e) => setNewBranch({ ...newBranch, sub_county: e.target.value })}
                  placeholder="e.g. Westlands"
                />
              </label>
            </div>
            <label className={LABEL_CLASS}>
              Outpatient Capacity (patients/day)
              <input
                type="number"
                min={0}
                className={FIELD_CLASS}
                value={newBranch.outpatient_capacity_per_day}
                onChange={(e) =>
                  setNewBranch({ ...newBranch, outpatient_capacity_per_day: e.target.value })
                }
                placeholder="e.g. 90"
              />
            </label>

            <div className="mt-1 flex items-start justify-between gap-3 rounded-md border border-surface-border p-3">
              <span className="flex flex-col">
                <span className="text-sm font-medium text-ink-900">CCP registration available</span>
                <span className="text-xs text-ink-500">
                  Enables Community Care Program registration at this branch
                </span>
              </span>
              <input
                type="checkbox"
                className="mt-1 h-4 w-8 shrink-0 cursor-pointer accent-brand-green"
                checked={newBranch.ccp_open}
                onChange={(e) => setNewBranch({ ...newBranch, ccp_open: e.target.checked })}
              />
            </div>

            <div>
              <div className={`${LABEL_CLASS} mb-2`}>Status</div>
              <div className="grid grid-cols-2 gap-3">
                {(
                  [
                    { value: true, title: "Active", desc: "Live and visible to org staff." },
                    { value: false, title: "Inactive", desc: "Hidden; history preserved." },
                  ] as const
                ).map((opt) => (
                  <label
                    key={opt.title}
                    className={`cursor-pointer rounded-md border p-3 text-left transition ${
                      newBranch.is_active === opt.value
                        ? "border-brand-green bg-brand-green-tint"
                        : "border-surface-border"
                    }`}
                  >
                    <input
                      type="radio"
                      name="branch-status"
                      className="sr-only"
                      checked={newBranch.is_active === opt.value}
                      onChange={() => setNewBranch({ ...newBranch, is_active: opt.value })}
                    />
                    <div className="text-sm font-semibold text-ink-900">{opt.title}</div>
                    <div className="text-xs text-ink-500">{opt.desc}</div>
                  </label>
                ))}
              </div>
            </div>

            {formError && (
              <p className="rounded-sm bg-status-red-tint px-3 py-2 text-sm text-status-red">
                {formError}
              </p>
            )}
          </div>
        </Drawer>
      </form>

      <div className="overflow-x-auto rounded-lg border border-surface-border bg-surface-card shadow-sm">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-surface-border bg-surface-bg text-xs font-semibold uppercase tracking-wide text-ink-500">
            <tr>
              <th className="px-4 py-3">Branch</th>
              <th className="px-4 py-3">Organization</th>
              <th className="px-4 py-3">County</th>
              <th className="px-4 py-3">MFL Code</th>
              <th className="px-4 py-3">Level</th>
              <th className="px-4 py-3">Wards</th>
              <th className="px-4 py-3">Beds</th>
              <th className="px-4 py-3">OP Capacity/day</th>
              <th className="px-4 py-3">CCP</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3">Actions</th>
            </tr>
          </thead>
          <tbody>
            {filteredBranches.map((b) => (
              <tr key={b.id} className="border-b border-surface-border last:border-0">
                <td className="px-4 py-3 font-medium text-ink-900">{b.name}</td>
                <td className="px-4 py-3 text-ink-700">{b.organization_name}</td>
                <td className="px-4 py-3 text-ink-700">
                  {b.county}
                  {b.sub_county ? ` / ${b.sub_county}` : ""}
                </td>
                <td className="px-4 py-3 font-mono text-xs text-ink-700">{b.mfl_code || "—"}</td>
                <td className="px-4 py-3 text-ink-700">{facilityLevelShort(b.facility_level)}</td>
                <td className="px-4 py-3 text-ink-700">{b.ward_count}</td>
                <td className="px-4 py-3 text-ink-700">{b.bed_count}</td>
                <td className="px-4 py-3 text-ink-700">{b.outpatient_capacity_per_day ?? "—"}</td>
                <td className="px-4 py-3">
                  <span
                    className={`rounded-sm px-2 py-0.5 text-xs font-semibold ${
                      CCP_TINT[b.ccp_registration_status]
                    }`}
                  >
                    {b.ccp_registration_status}
                  </span>
                </td>
                <td className="px-4 py-3">
                  <span
                    className={`rounded-sm px-2 py-0.5 text-xs font-semibold ${
                      b.is_active
                        ? "bg-brand-green-tint text-brand-green-dark"
                        : "bg-status-red-tint text-status-red"
                    }`}
                  >
                    {b.is_active ? "Active" : "Inactive"}
                  </span>
                </td>
                <td className="px-4 py-3">
                  <button
                    type="button"
                    disabled={busyId === b.id}
                    onClick={() => toggleActive(b)}
                    className="text-sm font-semibold text-brand-green hover:underline disabled:opacity-60"
                  >
                    {b.is_active ? "Deactivate" : "Activate"}
                  </button>
                </td>
              </tr>
            ))}
            {!loading && filteredBranches.length === 0 && (
              <tr>
                <td colSpan={11} className="px-4 py-6 text-center text-ink-500">
                  No branches found.
                </td>
              </tr>
            )}
          </tbody>
        </table>
        {loading && (
          <div className="flex items-center justify-center gap-2 px-4 py-6 text-sm text-ink-500">
            <Landmark className="h-4 w-4 animate-pulse" />
            Loading branches…
          </div>
        )}
      </div>

      {error && (
        <p className="rounded-sm bg-status-red-tint px-3 py-2 text-sm text-status-red">{error}</p>
      )}
    </div>
  );
}
