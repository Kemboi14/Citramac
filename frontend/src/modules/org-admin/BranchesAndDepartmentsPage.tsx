import { useEffect, useState } from "react";
import { Building2, LayoutGrid, Plus } from "lucide-react";
import { useAuth } from "../../auth/useAuth";
import { ApiError } from "../../lib/apiClient";
import { Drawer } from "../../components/Drawer";
import { SaveButton } from "../../components/SaveButton";
import { ResponsiveTable, type ResponsiveTableColumn } from "../../components/ResponsiveTable";
import { LocationFields } from "../../components/LocationFields";
import { createBranch, listBranches, updateBranch, type Branch } from "../../lib/branchesApi";
import {
  createDepartment,
  listDepartments,
  updateDepartment,
  type Department,
} from "../../lib/departmentsApi";

const FIELD_CLASS =
  "rounded-sm border border-surface-border bg-surface-card px-3 py-2 text-sm text-ink-900 outline-none transition-colors duration-150 focus:border-brand-green";
const LABEL_CLASS = "flex flex-col gap-1.5 text-sm font-medium text-ink-700";
const CARD_CLASS = "rounded-lg border border-surface-border bg-surface-card p-6 shadow-sm";
const BUTTON_CLASS =
  "inline-flex items-center gap-1.5 rounded-md bg-brand-green px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-brand-green-dark active:scale-[0.98] disabled:opacity-60 disabled:active:scale-100 transition-all duration-150";

const FACILITY_LEVELS: { value: Branch["facility_level"]; label: string }[] = [
  { value: "L2", label: "Level 2" },
  { value: "L3", label: "Level 3" },
  { value: "L4", label: "Level 4" },
  { value: "L5", label: "Level 5" },
  { value: "L6", label: "Level 6" },
];

interface BranchFormState {
  name: string;
  facility_level: Branch["facility_level"];
  mfl_code: string;
  address: string;
  country: string;
  county: string;
  sub_county: string;
  phone: string;
  email: string;
}

const EMPTY_BRANCH_FORM: BranchFormState = {
  name: "",
  facility_level: "L4",
  mfl_code: "",
  address: "",
  country: "Kenya",
  county: "",
  sub_county: "",
  phone: "",
  email: "",
};

interface DepartmentFormState {
  name: string;
  description: string;
  branch: string;
}

const EMPTY_DEPARTMENT_FORM: DepartmentFormState = { name: "", description: "", branch: "" };

/**
 * Org Admin's org-structure screen — create/edit/activate branches and
 * departments, and assign a department to a branch. Deliberately separate
 * from BranchSettingsPage.tsx, which keeps handling one branch's deep
 * settings (email/SMS/theme) — multi-branch-aware settings is a bigger,
 * separate scope this doesn't attempt.
 */
export function BranchesAndDepartmentsPage() {
  const { accessToken } = useAuth();

  const [branches, setBranches] = useState<Branch[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const [branchDrawer, setBranchDrawer] = useState<{ open: boolean; branch: Branch | null }>({
    open: false,
    branch: null,
  });
  const [branchForm, setBranchForm] = useState<BranchFormState>(EMPTY_BRANCH_FORM);
  const [branchFormError, setBranchFormError] = useState<string | null>(null);

  const [deptDrawer, setDeptDrawer] = useState<{ open: boolean; department: Department | null }>({
    open: false,
    department: null,
  });
  const [deptForm, setDeptForm] = useState<DepartmentFormState>(EMPTY_DEPARTMENT_FORM);
  const [deptFormError, setDeptFormError] = useState<string | null>(null);

  const load = async () => {
    if (!accessToken) return;
    const [branchRes, deptRes] = await Promise.all([
      listBranches(accessToken),
      listDepartments(accessToken),
    ]);
    setBranches(branchRes.results);
    setDepartments(deptRes.results);
  };

  useEffect(() => {
    if (!accessToken) return;
    void Promise.resolve().then(() =>
      load()
        .catch((err) =>
          setError(err instanceof ApiError ? err.message : "Couldn't load branches."),
        )
        .finally(() => setLoading(false)),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accessToken]);

  const openNewBranch = () => {
    setBranchForm(EMPTY_BRANCH_FORM);
    setBranchFormError(null);
    setBranchDrawer({ open: true, branch: null });
  };
  const openEditBranch = (branch: Branch) => {
    setBranchForm({
      name: branch.name,
      facility_level: branch.facility_level,
      mfl_code: branch.mfl_code,
      address: branch.address,
      country: branch.country || "Kenya",
      county: branch.county,
      sub_county: branch.sub_county,
      phone: branch.phone,
      email: branch.email,
    });
    setBranchFormError(null);
    setBranchDrawer({ open: true, branch });
  };

  const saveBranch = async () => {
    if (!accessToken) return;
    setBranchFormError(null);
    try {
      if (branchDrawer.branch) {
        const updated = await updateBranch(accessToken, branchDrawer.branch.id, branchForm);
        setBranches((prev) => prev.map((b) => (b.id === updated.id ? updated : b)));
      } else {
        const created = await createBranch(accessToken, branchForm);
        setBranches((prev) => [...prev, created]);
      }
      setBranchDrawer({ open: false, branch: null });
    } catch (err) {
      setBranchFormError(err instanceof ApiError ? err.message : "Couldn't save this branch.");
      throw err;
    }
  };

  const toggleBranchActive = async (branch: Branch) => {
    if (!accessToken) return;
    setBusyId(branch.id);
    try {
      const updated = await updateBranch(accessToken, branch.id, { is_active: !branch.is_active });
      setBranches((prev) => prev.map((b) => (b.id === updated.id ? updated : b)));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't update this branch.");
    } finally {
      setBusyId(null);
    }
  };

  const openNewDepartment = () => {
    setDeptForm(EMPTY_DEPARTMENT_FORM);
    setDeptFormError(null);
    setDeptDrawer({ open: true, department: null });
  };
  const openEditDepartment = (department: Department) => {
    setDeptForm({
      name: department.name,
      description: department.description,
      branch: department.branch ?? "",
    });
    setDeptFormError(null);
    setDeptDrawer({ open: true, department });
  };

  const saveDepartment = async () => {
    if (!accessToken) return;
    setDeptFormError(null);
    const payload = {
      name: deptForm.name,
      description: deptForm.description,
      branch: deptForm.branch || null,
    };
    try {
      if (deptDrawer.department) {
        const updated = await updateDepartment(accessToken, deptDrawer.department.id, payload);
        setDepartments((prev) => prev.map((d) => (d.id === updated.id ? updated : d)));
      } else {
        const created = await createDepartment(accessToken, payload);
        setDepartments((prev) => [...prev, created]);
      }
      setDeptDrawer({ open: false, department: null });
    } catch (err) {
      setDeptFormError(err instanceof ApiError ? err.message : "Couldn't save this department.");
      throw err;
    }
  };

  const toggleDepartmentActive = async (department: Department) => {
    if (!accessToken) return;
    setBusyId(department.id);
    try {
      const updated = await updateDepartment(accessToken, department.id, {
        is_active: !department.is_active,
      });
      setDepartments((prev) => prev.map((d) => (d.id === updated.id ? updated : d)));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't update this department.");
    } finally {
      setBusyId(null);
    }
  };

  const departmentCount = (branchId: string) =>
    departments.filter((d) => d.branch === branchId).length;

  const branchColumns: ResponsiveTableColumn<Branch>[] = [
    {
      key: "name",
      header: "Branch",
      cardTitle: true,
      cell: (b) => (
        <div>
          <div className="font-medium text-ink-900">{b.name}</div>
          <div className="text-xs text-ink-500">{b.mfl_code || "No MFL code yet"}</div>
        </div>
      ),
    },
    {
      key: "level",
      header: "Level",
      cell: (b) => FACILITY_LEVELS.find((l) => l.value === b.facility_level)?.label ?? b.facility_level,
    },
    {
      key: "departments",
      header: "Departments",
      cell: (b) => departmentCount(b.id),
    },
    {
      key: "status",
      header: "Status",
      cardBadge: true,
      cell: (b) => (
        <button
          type="button"
          disabled={busyId === b.id}
          onClick={() => toggleBranchActive(b)}
          className={`rounded-full px-2.5 py-1 text-xs font-semibold ${
            b.is_active
              ? "bg-brand-green-tint text-brand-green-dark"
              : "bg-status-red-tint text-status-red"
          }`}
        >
          {b.is_active ? "Active" : "Inactive"}
        </button>
      ),
    },
    {
      key: "actions",
      header: "",
      hideInCard: true,
      className: "px-4 py-3 text-right",
      cell: (b) => (
        <button
          type="button"
          onClick={() => openEditBranch(b)}
          className="text-[12.5px] font-semibold text-brand-green hover:underline"
        >
          Edit
        </button>
      ),
    },
  ];

  const departmentColumns: ResponsiveTableColumn<Department>[] = [
    {
      key: "name",
      header: "Department",
      cardTitle: true,
      cell: (d) => d.name,
    },
    {
      key: "branch",
      header: "Branch",
      cardSubtitle: true,
      cell: (d) => d.branch_name || "Unassigned",
    },
    {
      key: "status",
      header: "Status",
      cardBadge: true,
      cell: (d) => (
        <button
          type="button"
          disabled={busyId === d.id}
          onClick={() => toggleDepartmentActive(d)}
          className={`rounded-full px-2.5 py-1 text-xs font-semibold ${
            d.is_active
              ? "bg-brand-green-tint text-brand-green-dark"
              : "bg-status-red-tint text-status-red"
          }`}
        >
          {d.is_active ? "Active" : "Inactive"}
        </button>
      ),
    },
    {
      key: "actions",
      header: "",
      hideInCard: true,
      className: "px-4 py-3 text-right",
      cell: (d) => (
        <button
          type="button"
          onClick={() => openEditDepartment(d)}
          className="text-[12.5px] font-semibold text-brand-green hover:underline"
        >
          Edit
        </button>
      ),
    },
  ];

  return (
    <div className="flex flex-col gap-6 animate-fade-in">
      <div>
        <div className="mb-1.5 text-[11px] font-bold uppercase tracking-wide text-brand-green">
          Facility &middot; Organisational Structure
        </div>
        <h1 className="font-display text-2xl font-bold text-ink-900">Branches &amp; Departments</h1>
        <p className="mt-1 text-sm text-ink-500">
          Set up your organisation's physical locations and the departments within them, so staff
          and clinical activity can be correctly attributed.
        </p>
      </div>

      {loading && <p className="text-sm text-ink-500">Loading…</p>}
      {error && (
        <p className="rounded-sm bg-status-red-tint px-3 py-2 text-sm text-status-red">{error}</p>
      )}

      {!loading && (
        <>
          <section className={CARD_CLASS}>
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
              <h2 className="flex items-center gap-2 font-display text-base font-semibold text-ink-900">
                <Building2 size={16} className="text-brand-green" />
                Branches / Locations
              </h2>
              <button type="button" className={BUTTON_CLASS} onClick={openNewBranch}>
                <Plus size={14} />
                Add Branch
              </button>
            </div>
            <ResponsiveTable
              columns={branchColumns}
              rows={branches}
              rowKey={(b) => b.id}
              emptyMessage="No branches yet — add your first one."
            />
          </section>

          <section className={CARD_CLASS}>
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
              <h2 className="flex items-center gap-2 font-display text-base font-semibold text-ink-900">
                <LayoutGrid size={16} className="text-brand-green" />
                Departments
              </h2>
              <button
                type="button"
                className={BUTTON_CLASS}
                onClick={openNewDepartment}
                disabled={branches.length === 0}
                title={branches.length === 0 ? "Add a branch first" : undefined}
              >
                <Plus size={14} />
                Add Department
              </button>
            </div>
            <ResponsiveTable
              columns={departmentColumns}
              rows={departments}
              rowKey={(d) => d.id}
              emptyMessage="No departments yet."
            />
          </section>
        </>
      )}

      <Drawer
        open={branchDrawer.open}
        title={branchDrawer.branch ? "Edit Branch" : "Add Branch"}
        onClose={() => setBranchDrawer({ open: false, branch: null })}
        footer={
          <SaveButton onSave={saveBranch}>
            {branchDrawer.branch ? "Save Changes" : "Create Branch"}
          </SaveButton>
        }
      >
        <form onSubmit={(e) => e.preventDefault()} className="flex flex-col gap-4">
          <label className={LABEL_CLASS}>
            Name
            <input
              className={FIELD_CLASS}
              value={branchForm.name}
              onChange={(e) => setBranchForm({ ...branchForm, name: e.target.value })}
              required
            />
          </label>
          <label className={LABEL_CLASS}>
            Facility Level
            <select
              className={FIELD_CLASS}
              value={branchForm.facility_level}
              onChange={(e) =>
                setBranchForm({
                  ...branchForm,
                  facility_level: e.target.value as Branch["facility_level"],
                })
              }
            >
              {FACILITY_LEVELS.map((l) => (
                <option key={l.value} value={l.value}>
                  {l.label}
                </option>
              ))}
            </select>
          </label>
          <label className={LABEL_CLASS}>
            MFL Code
            <input
              className={FIELD_CLASS}
              value={branchForm.mfl_code}
              onChange={(e) => setBranchForm({ ...branchForm, mfl_code: e.target.value })}
              placeholder="Optional — can be added once verified"
            />
          </label>
          <label className={LABEL_CLASS}>
            Address
            <input
              className={FIELD_CLASS}
              value={branchForm.address}
              onChange={(e) => setBranchForm({ ...branchForm, address: e.target.value })}
            />
          </label>
          <LocationFields
            labelClassName={LABEL_CLASS}
            fieldClassName={FIELD_CLASS}
            country={branchForm.country}
            county={branchForm.county}
            subCounty={branchForm.sub_county}
            onCountryChange={(v) => setBranchForm({ ...branchForm, country: v })}
            onCountyChange={(v) => setBranchForm({ ...branchForm, county: v })}
            onSubCountyChange={(v) => setBranchForm({ ...branchForm, sub_county: v })}
          />
          <div className="flex flex-wrap gap-4">
            <label className={`${LABEL_CLASS} flex-1`}>
              Phone
              <input
                className={FIELD_CLASS}
                value={branchForm.phone}
                onChange={(e) => setBranchForm({ ...branchForm, phone: e.target.value })}
              />
            </label>
            <label className={`${LABEL_CLASS} flex-1`}>
              Email
              <input
                type="email"
                className={FIELD_CLASS}
                value={branchForm.email}
                onChange={(e) => setBranchForm({ ...branchForm, email: e.target.value })}
              />
            </label>
          </div>
          {branchFormError && (
            <p className="rounded-sm bg-status-red-tint px-3 py-2 text-sm text-status-red">
              {branchFormError}
            </p>
          )}
        </form>
      </Drawer>

      <Drawer
        open={deptDrawer.open}
        title={deptDrawer.department ? "Edit Department" : "Add Department"}
        onClose={() => setDeptDrawer({ open: false, department: null })}
        footer={
          <SaveButton onSave={saveDepartment}>
            {deptDrawer.department ? "Save Changes" : "Create Department"}
          </SaveButton>
        }
      >
        <form onSubmit={(e) => e.preventDefault()} className="flex flex-col gap-4">
          <label className={LABEL_CLASS}>
            Name
            <input
              className={FIELD_CLASS}
              value={deptForm.name}
              onChange={(e) => setDeptForm({ ...deptForm, name: e.target.value })}
              required
            />
          </label>
          <label className={LABEL_CLASS}>
            Branch
            <select
              className={FIELD_CLASS}
              value={deptForm.branch}
              onChange={(e) => setDeptForm({ ...deptForm, branch: e.target.value })}
            >
              <option value="">Unassigned</option>
              {branches.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </select>
          </label>
          <label className={LABEL_CLASS}>
            Description
            <textarea
              className={FIELD_CLASS}
              rows={3}
              value={deptForm.description}
              onChange={(e) => setDeptForm({ ...deptForm, description: e.target.value })}
            />
          </label>
          {deptFormError && (
            <p className="rounded-sm bg-status-red-tint px-3 py-2 text-sm text-status-red">
              {deptFormError}
            </p>
          )}
        </form>
      </Drawer>
    </div>
  );
}
