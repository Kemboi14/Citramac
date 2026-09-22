import { useEffect, useMemo, useState } from "react";
import {
  BedDouble,
  Building2,
  LayoutGrid,
  Landmark,
  Loader2,
  Plus,
  Search,
  ShieldCheck,
} from "lucide-react";
import { useAuth } from "../../auth/useAuth";
import { ApiError } from "../../lib/apiClient";
import {
  createBranch,
  listBranches,
  updateBranch,
  type Branch,
  type MhpRegistrationStatus,
} from "../../lib/branchesApi";
import {
  createDepartment,
  listDepartments,
  updateDepartment,
  type Department,
} from "../../lib/departmentsApi";
import { listOrganizations, type Organization } from "../../lib/organizationsApi";
import { StatCard } from "../../components/StatCard";
import { Drawer } from "../../components/Drawer";
import { SaveButton } from "../../components/SaveButton";
import { LocationFields } from "../../components/LocationFields";
import { ResponsiveTable, type ResponsiveTableColumn } from "../../components/ResponsiveTable";

const FIELD_CLASS =
  "rounded-sm border border-surface-border bg-surface-card px-3 py-2 text-sm text-ink-900 outline-none transition-colors duration-150 focus:border-brand-green";
const LABEL_CLASS = "flex flex-col gap-1.5 text-sm font-medium text-ink-700";
const BUTTON_CLASS =
  "inline-flex items-center gap-2 rounded-md bg-brand-green px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-brand-green-dark active:scale-[0.98] disabled:opacity-60 disabled:active:scale-100 transition-all duration-150";

const MHP_TINT: Record<MhpRegistrationStatus, string> = {
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

function statusToggle(active: boolean, busy: boolean, onToggle: () => void) {
  return (
    <button
      type="button"
      disabled={busy}
      onClick={onToggle}
      className={`rounded-full px-2.5 py-1 text-xs font-semibold disabled:opacity-60 ${
        active ? "bg-brand-green-tint text-brand-green-dark" : "bg-status-red-tint text-status-red"
      }`}
    >
      {active ? "Active" : "Inactive"}
    </button>
  );
}

type StatusFilter = "all" | "active" | "mhp" | "inactive";
type Tab = "branches" | "departments";

const STATUS_FILTERS: { label: string; value: StatusFilter }[] = [
  { label: "All", value: "all" },
  { label: "Active", value: "active" },
  { label: "MHP-Registered", value: "mhp" },
  { label: "Inactive", value: "inactive" },
];

interface NewBranchState {
  organization: string;
  name: string;
  mfl_code: string;
  facility_level: string;
  address: string;
  country: string;
  county: string;
  sub_county: string;
  outpatient_capacity_per_day: string;
  mhp_open: boolean;
  is_active: boolean;
}

const EMPTY_NEW_BRANCH: NewBranchState = {
  organization: "",
  name: "",
  mfl_code: "",
  facility_level: "L4",
  address: "",
  country: "Kenya",
  county: "",
  sub_county: "",
  outpatient_capacity_per_day: "",
  mhp_open: false,
  is_active: true,
};

interface NewDepartmentState {
  organization: string;
  branch: string;
  name: string;
  description: string;
  is_active: boolean;
}

const EMPTY_NEW_DEPARTMENT: NewDepartmentState = {
  organization: "",
  branch: "",
  name: "",
  description: "",
  is_active: true,
};

const branchFormId = "branch-form";
const deptFormId = "department-form";

/**
 * Super Admin — Branches & Departments. Every physical facility and org
 * sub-unit across every tenant on the platform; the backend already scopes
 * the JWT to see everything so this page simply renders what comes back.
 * Mirrors the Org Admin "Branches & Departments" screen's create/toggle
 * shape, plus an Organization picker on create since Super Admin acts on
 * behalf of any tenant rather than an implicit one.
 *
 * Search + status chips filter the already-fetched page client-side, mirroring
 * the mockup's own `filterBranchTable()` behaviour — the backend's `q` param
 * only matches name/MFL code (see BranchViewSet.get_queryset), not
 * organization name, and there's no `is_active` query param at all, so a
 * single client-side filter over one fetch covers name + org + MFL code +
 * active/MHP status without extra round-trips.
 */
export function BranchesPage() {
  const { accessToken } = useAuth();
  const [tab, setTab] = useState<Tab>("branches");

  const [branches, setBranches] = useState<Branch[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [organizations, setOrganizations] = useState<Organization[]>([]);
  const [count, setCount] = useState(0);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const [showBranchForm, setShowBranchForm] = useState(false);
  const [branchFormError, setBranchFormError] = useState<string | null>(null);
  const [newBranch, setNewBranch] = useState<NewBranchState>(EMPTY_NEW_BRANCH);
  // Functional update, not `updateNewBranch({ ...patch })` — see
  // the identical fix/comment in org-admin/BranchesAndDepartmentsPage.tsx:
  // LocationFields' county handler fires two same-tick state updates that
  // silently stomped each other under the stale-closure spread pattern.
  const updateNewBranch = (patch: Partial<NewBranchState>) =>
    setNewBranch((prev) => ({ ...prev, ...patch }));

  const [showDeptForm, setShowDeptForm] = useState(false);
  const [deptFormError, setDeptFormError] = useState<string | null>(null);
  const [newDept, setNewDept] = useState<NewDepartmentState>(EMPTY_NEW_DEPARTMENT);

  const refresh = async () => {
    if (!accessToken) return;
    setLoading(true);
    setError(null);
    try {
      const [branchRes, deptRes] = await Promise.all([
        listBranches(accessToken),
        listDepartments(accessToken),
      ]);
      setBranches(branchRes.results);
      setCount(branchRes.count);
      setDepartments(deptRes.results);
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
      if (statusFilter === "mhp") return b.mhp_registration_status === "OPEN";
      return true;
    });
  }, [branches, search, statusFilter]);

  const filteredDepartments = useMemo(() => {
    const q = search.trim().toLowerCase();
    return departments.filter((d) => {
      if (q) {
        const haystack = `${d.name} ${d.organization_name} ${d.branch_name}`.toLowerCase();
        if (!haystack.includes(q)) return false;
      }
      if (statusFilter === "active") return d.is_active;
      if (statusFilter === "inactive") return !d.is_active;
      return true;
    });
  }, [departments, search, statusFilter]);

  const openBranchForm = () => {
    setBranchFormError(null);
    setNewBranch(EMPTY_NEW_BRANCH);
    setShowBranchForm(true);
  };

  const submitNewBranch = async () => {
    if (!accessToken || !newBranch.organization || !newBranch.name) return;
    setBranchFormError(null);
    try {
      const created = await createBranch(accessToken, {
        organization: newBranch.organization,
        name: newBranch.name,
        mfl_code: newBranch.mfl_code || undefined,
        facility_level: newBranch.facility_level,
        address: newBranch.address || undefined,
        country: newBranch.country || undefined,
        county: newBranch.county || undefined,
        sub_county: newBranch.sub_county || undefined,
        outpatient_capacity_per_day: newBranch.outpatient_capacity_per_day
          ? Number(newBranch.outpatient_capacity_per_day)
          : undefined,
        mhp_registration_status: newBranch.mhp_open ? "OPEN" : "CLOSED",
        is_active: newBranch.is_active,
      });
      setBranches((prev) => [...prev, created]);
      setCount((c) => c + 1);
      setShowBranchForm(false);
      setNewBranch(EMPTY_NEW_BRANCH);
    } catch (err) {
      setBranchFormError(err instanceof ApiError ? err.message : "Couldn't create the branch.");
      throw err;
    }
  };

  const toggleBranchActive = async (branch: Branch) => {
    if (!accessToken) return;
    setBusyId(branch.id);
    setError(null);
    try {
      const updated = await updateBranch(accessToken, branch.id, { is_active: !branch.is_active });
      setBranches((prev) => prev.map((b) => (b.id === updated.id ? updated : b)));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't update the branch status.");
    } finally {
      setBusyId(null);
    }
  };

  const openDeptForm = () => {
    setDeptFormError(null);
    setNewDept(EMPTY_NEW_DEPARTMENT);
    setShowDeptForm(true);
  };

  const submitNewDept = async () => {
    if (!accessToken || !newDept.organization || !newDept.name) return;
    setDeptFormError(null);
    try {
      const created = await createDepartment(accessToken, {
        organization: newDept.organization,
        branch: newDept.branch || null,
        name: newDept.name,
        description: newDept.description || undefined,
        is_active: newDept.is_active,
      });
      setDepartments((prev) => [...prev, created]);
      setShowDeptForm(false);
      setNewDept(EMPTY_NEW_DEPARTMENT);
    } catch (err) {
      setDeptFormError(err instanceof ApiError ? err.message : "Couldn't create the department.");
      throw err;
    }
  };

  const toggleDeptActive = async (department: Department) => {
    if (!accessToken) return;
    setBusyId(department.id);
    setError(null);
    try {
      const updated = await updateDepartment(accessToken, department.id, {
        is_active: !department.is_active,
      });
      setDepartments((prev) => prev.map((d) => (d.id === updated.id ? updated : d)));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't update the department status.");
    } finally {
      setBusyId(null);
    }
  };

  const branchesForNewDeptOrg = useMemo(
    () => branches.filter((b) => b.organization === newDept.organization),
    [branches, newDept.organization],
  );

  const totalBranches = count || branches.length;
  const totalWards = branches.reduce((sum, b) => sum + (b.ward_count ?? 0), 0);
  const totalBeds = branches.reduce((sum, b) => sum + (b.bed_count ?? 0), 0);
  const mhpOpenCount = branches.filter((b) => b.mhp_registration_status === "OPEN").length;

  const branchColumns: ResponsiveTableColumn<Branch>[] = [
    { key: "name", header: "Branch", cardTitle: true, cell: (b) => b.name },
    { key: "org", header: "Organization", cardSubtitle: true, cell: (b) => b.organization_name },
    {
      key: "county",
      header: "County",
      cell: (b) => `${b.county}${b.sub_county ? ` / ${b.sub_county}` : ""}` || "—",
    },
    {
      key: "mfl",
      header: "MFL Code",
      className: "px-4 py-3 font-mono text-xs text-ink-700",
      cell: (b) => b.mfl_code || "—",
    },
    { key: "level", header: "Level", cell: (b) => facilityLevelShort(b.facility_level) },
    { key: "wards", header: "Wards", cell: (b) => b.ward_count },
    { key: "beds", header: "Beds", cell: (b) => b.bed_count },
    { key: "capacity", header: "OP Capacity/day", cell: (b) => b.outpatient_capacity_per_day ?? "—" },
    {
      key: "mhp",
      header: "MHP",
      cell: (b) => (
        <span className={`rounded-sm px-2 py-0.5 text-xs font-semibold ${MHP_TINT[b.mhp_registration_status]}`}>
          {b.mhp_registration_status}
        </span>
      ),
    },
    {
      key: "status",
      header: "Status",
      cardBadge: true,
      cell: (b) => statusToggle(b.is_active, busyId === b.id, () => toggleBranchActive(b)),
    },
  ];

  const departmentColumns: ResponsiveTableColumn<Department>[] = [
    { key: "name", header: "Department", cardTitle: true, cell: (d) => d.name },
    { key: "org", header: "Organization", cardSubtitle: true, cell: (d) => d.organization_name },
    { key: "branch", header: "Branch", cell: (d) => d.branch_name || "Unassigned" },
    { key: "description", header: "Description", cell: (d) => d.description || "—" },
    {
      key: "status",
      header: "Status",
      cardBadge: true,
      cell: (d) => statusToggle(d.is_active, busyId === d.id, () => toggleDeptActive(d)),
    },
  ];

  return (
    <div className="flex flex-col gap-6 animate-fade-in">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="mb-1.5 text-[11px] font-bold uppercase tracking-wide text-brand-green">
            Platform · Facilities
          </div>
          <h1 className="font-display text-2xl font-bold text-ink-900">Branches &amp; Departments</h1>
        </div>
        <button
          type="button"
          className={BUTTON_CLASS}
          onClick={tab === "branches" ? openBranchForm : openDeptForm}
        >
          <Plus className="h-4 w-4" />
          {tab === "branches" ? "Add Branch" : "Add Department"}
        </button>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard icon={Landmark} value={totalBranches} label="Total Branches" />
        <StatCard icon={LayoutGrid} value={departments.length} label="Total Departments" />
        <StatCard icon={Building2} value={totalWards} label="Wards Registered" />
        <StatCard icon={BedDouble} value={totalBeds} label="Beds Across Platform" />
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="inline-flex rounded-md border border-surface-border bg-surface-card p-1">
          {(
            [
              { value: "branches" as const, label: "Branches", count: totalBranches },
              { value: "departments" as const, label: "Departments", count: departments.length },
            ]
          ).map((t) => (
            <button
              key={t.value}
              type="button"
              onClick={() => setTab(t.value)}
              className={`rounded-sm px-3 py-1.5 text-sm font-semibold transition-colors duration-150 ${
                tab === t.value ? "bg-brand-green text-white" : "text-ink-700 hover:bg-surface-bg"
              }`}
            >
              {t.label} ({t.count})
            </button>
          ))}
        </div>
        {tab === "branches" && (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-status-amber-tint px-3 py-1 text-xs font-semibold text-status-amber">
            <ShieldCheck className="h-3.5 w-3.5" />
            {mhpOpenCount} MHP-registered
          </span>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-400" />
          <input
            className={`${FIELD_CLASS} w-72 pl-9`}
            placeholder={
              tab === "branches" ? "Search by branch, org, or MFL code…" : "Search by department, org, or branch…"
            }
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <div className="flex gap-2">
          {STATUS_FILTERS.filter((f) => tab === "branches" || f.value !== "mhp").map((filter) => (
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

      <Drawer
        open={showBranchForm}
        title="Add Branch"
        subtitle="Register a new facility under an organization"
        onClose={() => setShowBranchForm(false)}
        footer={
          <>
            <button
              type="button"
              className="rounded-md border border-surface-border px-4 py-2 text-sm font-semibold text-ink-700 hover:bg-surface-bg"
              onClick={() => setShowBranchForm(false)}
            >
              Cancel
            </button>
            <SaveButton onSave={submitNewBranch} className="flex-1">
              Create Branch
            </SaveButton>
          </>
        }
      >
        <form id={branchFormId} onSubmit={(e) => e.preventDefault()} className="flex flex-col gap-4">
          <label className={LABEL_CLASS}>
            Parent Organization <span className="text-status-red">*</span>
            <select
              className={FIELD_CLASS}
              value={newBranch.organization}
              onChange={(e) => updateNewBranch({ organization: e.target.value })}
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
              onChange={(e) => updateNewBranch({ name: e.target.value })}
              placeholder="e.g. Rehab Wing"
              required
            />
          </label>

          <div>
            <h3 className="mb-3 font-display text-sm font-semibold text-ink-900">
              Facility Details
            </h3>
            <div className="flex flex-col gap-4">
              <label className={LABEL_CLASS}>
                Facility Level <span className="text-status-red">*</span>
                <select
                  className={FIELD_CLASS}
                  value={newBranch.facility_level}
                  onChange={(e) => updateNewBranch({ facility_level: e.target.value })}
                >
                  {FACILITY_LEVEL_OPTIONS.map((level) => (
                    <option key={level.value} value={level.value}>
                      {level.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className={LABEL_CLASS}>
                Branch DHA MFL Code
                <input
                  className={FIELD_CLASS}
                  value={newBranch.mfl_code}
                  onChange={(e) => updateNewBranch({ mfl_code: e.target.value })}
                  placeholder="e.g. MFL-14238-B2"
                />
              </label>
              <label className={LABEL_CLASS}>
                Address
                <input
                  className={FIELD_CLASS}
                  value={newBranch.address}
                  onChange={(e) => updateNewBranch({ address: e.target.value })}
                  placeholder="e.g. Waiyaki Way, Westlands"
                />
              </label>
              <LocationFields
                labelClassName={LABEL_CLASS}
                fieldClassName={FIELD_CLASS}
                country={newBranch.country}
                county={newBranch.county}
                subCounty={newBranch.sub_county}
                onCountryChange={(v) => updateNewBranch({ country: v })}
                onCountyChange={(v) => updateNewBranch({ county: v })}
                onSubCountyChange={(v) => updateNewBranch({ sub_county: v })}
              />
            </div>
          </div>

          <div>
            <h3 className="mb-3 font-display text-sm font-semibold text-ink-900">
              Capacity &amp; Program
            </h3>
            <div className="flex flex-col gap-4">
              <label className={LABEL_CLASS}>
                Outpatient Capacity (patients/day)
                <input
                  type="number"
                  min={0}
                  className={FIELD_CLASS}
                  value={newBranch.outpatient_capacity_per_day}
                  onChange={(e) =>
                    updateNewBranch({ outpatient_capacity_per_day: e.target.value })
                  }
                  placeholder="e.g. 90"
                />
              </label>
              <div className="flex items-start justify-between gap-3 rounded-md border border-surface-border p-3">
                <span className="flex flex-col">
                  <span className="text-sm font-medium text-ink-900">
                    MHP registration available
                  </span>
                  <span className="text-xs text-ink-500">
                    Enables Mental Health Program registration at this branch
                  </span>
                </span>
                <input
                  type="checkbox"
                  className="mt-1 h-4 w-8 shrink-0 cursor-pointer accent-brand-green"
                  checked={newBranch.mhp_open}
                  onChange={(e) => updateNewBranch({ mhp_open: e.target.checked })}
                />
              </div>
            </div>
          </div>

          <div>
            <h3 className="mb-3 font-display text-sm font-semibold text-ink-900">Status</h3>
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
                    onChange={() => updateNewBranch({ is_active: opt.value })}
                  />
                  <div className="text-sm font-semibold text-ink-900">{opt.title}</div>
                  <div className="text-xs text-ink-500">{opt.desc}</div>
                </label>
              ))}
            </div>
          </div>

          {branchFormError && (
            <p className="rounded-sm bg-status-red-tint px-3 py-2 text-sm text-status-red">
              {branchFormError}
            </p>
          )}
        </form>
      </Drawer>

      <Drawer
        open={showDeptForm}
        title="Add Department"
        subtitle="Register a new department under an organization"
        onClose={() => setShowDeptForm(false)}
        footer={
          <>
            <button
              type="button"
              className="rounded-md border border-surface-border px-4 py-2 text-sm font-semibold text-ink-700 hover:bg-surface-bg"
              onClick={() => setShowDeptForm(false)}
            >
              Cancel
            </button>
            <SaveButton onSave={submitNewDept} className="flex-1">
              Create Department
            </SaveButton>
          </>
        }
      >
        <form id={deptFormId} onSubmit={(e) => e.preventDefault()} className="flex flex-col gap-4">
          <label className={LABEL_CLASS}>
            Parent Organization <span className="text-status-red">*</span>
            <select
              className={FIELD_CLASS}
              value={newDept.organization}
              onChange={(e) => setNewDept({ ...newDept, organization: e.target.value, branch: "" })}
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
            Branch
            <select
              className={FIELD_CLASS}
              value={newDept.branch}
              disabled={!newDept.organization}
              onChange={(e) => setNewDept({ ...newDept, branch: e.target.value })}
            >
              <option value="">
                {newDept.organization ? "Unassigned" : "Select an organization first"}
              </option>
              {branchesForNewDeptOrg.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </select>
          </label>
          <label className={LABEL_CLASS}>
            Department Name <span className="text-status-red">*</span>
            <input
              className={FIELD_CLASS}
              value={newDept.name}
              onChange={(e) => setNewDept({ ...newDept, name: e.target.value })}
              placeholder="e.g. Pharmacy"
              required
            />
          </label>
          <label className={LABEL_CLASS}>
            Description
            <textarea
              className={FIELD_CLASS}
              rows={2}
              value={newDept.description}
              onChange={(e) => setNewDept({ ...newDept, description: e.target.value })}
            />
          </label>

          {deptFormError && (
            <p className="rounded-sm bg-status-red-tint px-3 py-2 text-sm text-status-red">
              {deptFormError}
            </p>
          )}
        </form>
      </Drawer>

      {tab === "branches" ? (
        <ResponsiveTable
          columns={branchColumns}
          rows={filteredBranches}
          rowKey={(b) => b.id}
          emptyMessage={loading ? "Loading branches…" : "No branches found."}
        />
      ) : (
        <ResponsiveTable
          columns={departmentColumns}
          rows={filteredDepartments}
          rowKey={(d) => d.id}
          emptyMessage={loading ? "Loading departments…" : "No departments found."}
        />
      )}

      {loading && (
        <div className="flex items-center justify-center gap-2 px-4 py-2 text-sm text-ink-500">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading…
        </div>
      )}

      {error && (
        <p className="rounded-sm bg-status-red-tint px-3 py-2 text-sm text-status-red">{error}</p>
      )}
    </div>
  );
}
