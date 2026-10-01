import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { AlertTriangle, Archive, History, PlayCircle, Scale, Search } from "lucide-react";
import { useAuth } from "../../auth/useAuth";
import { ApiError } from "../../lib/apiClient";
import { listPatients, type PatientListRow } from "../../lib/clinicalApi";
import type { Paginated } from "../../lib/organizationsApi";
import { Drawer } from "../../components/Drawer";
import { ResponsiveTable, type ResponsiveTableColumn } from "../../components/ResponsiveTable";
import { SaveButton } from "../../components/SaveButton";
import { WideModal } from "../../components/WideModal";
import {
  approveArchiveBatch,
  getPatientLifecycleHistory,
  getRetentionPolicy,
  listArchiveBatchItems,
  listArchiveBatches,
  listArchivedPatients,
  listRetentionScans,
  rejectArchiveBatch,
  restorePatient,
  runRetentionScan,
  setPatientLegalHold,
  updateRetentionPolicy,
  type ArchiveBatch,
  type ArchiveBatchItem,
  type ArchiveBatchStatus,
  type ArchivedPatient,
  type OrganizationRetentionPolicy,
  type PatientLifecycleEvent,
  type RetentionScanRun,
} from "../../lib/retentionApi";

const FIELD_CLASS =
  "rounded-sm border border-surface-border bg-surface-card px-3 py-2 text-sm text-ink-900 outline-none transition-colors duration-150 focus:border-brand-green";
const LABEL_CLASS = "flex flex-col gap-1.5 text-sm font-medium text-ink-700";
const CARD_CLASS = "rounded-lg border border-surface-border bg-surface-card p-6 shadow-sm";
const SECTION_TITLE_CLASS = "mb-4 font-display text-base font-semibold text-ink-900";
const BUTTON_CLASS =
  "rounded-md bg-brand-green px-4 py-2 text-sm font-semibold text-on-primary shadow-sm hover:bg-brand-green-dark active:scale-[0.98] disabled:opacity-60 disabled:active:scale-100 transition-all duration-150";
const GHOST_BUTTON_CLASS =
  "rounded-md border border-surface-border px-4 py-2 text-sm font-semibold text-ink-700 hover:bg-surface-bg disabled:opacity-60";
const DANGER_BUTTON_CLASS =
  "rounded-md border border-status-red bg-status-red-tint px-4 py-2 text-sm font-semibold text-status-red hover:opacity-90 disabled:opacity-60";
const LINK_BUTTON_CLASS =
  "text-[11.5px] font-semibold text-brand-green hover:underline disabled:opacity-50";
const BADGE_CLASS = "rounded-full px-2.5 py-1 text-xs font-semibold";
const ERROR_CLASS = "rounded-sm bg-status-red-tint px-3 py-2 text-sm text-status-red";

const TABS = [
  "Retention policy",
  "Scans & forecast",
  "Archive batches",
  "Archived records",
  "Legal holds",
] as const;
type Tab = (typeof TABS)[number];

const CATEGORIES = [
  {
    key: "clinical",
    field: "clinical_years",
    label: "Clinical records",
    help: "Applies to every client record.",
  },
  {
    key: "mental_health",
    field: "mental_health_years",
    label: "Mental health & substance use",
    help: "Applies when the record holds any mental status exam, psychotherapy or substance-use treatment entry.",
  },
  {
    key: "financial",
    field: "financial_years",
    label: "Financial records",
    help: "Applies when the record holds any invoice, payment or insurance claim.",
  },
] as const;
type YearsField = (typeof CATEGORIES)[number]["field"];

const BATCH_STATUS_LABEL: Record<ArchiveBatchStatus, string> = {
  PENDING_APPROVAL: "Pending approval",
  ARCHIVED: "Archived",
  REJECTED: "Rejected",
};
const BATCH_STATUS_TINT: Record<ArchiveBatchStatus, string> = {
  PENDING_APPROVAL: "bg-status-amber-tint text-status-amber",
  ARCHIVED: "bg-brand-green-tint text-brand-green-dark",
  REJECTED: "bg-status-red-tint text-status-red",
};

const ITEM_OUTCOME_LABEL: Record<ArchiveBatchItem["outcome"], string> = {
  PENDING: "Pending",
  ARCHIVED: "Archived",
  SKIPPED: "Skipped",
};
const ITEM_OUTCOME_TINT: Record<ArchiveBatchItem["outcome"], string> = {
  PENDING: "bg-status-amber-tint text-status-amber",
  ARCHIVED: "bg-brand-green-tint text-brand-green-dark",
  SKIPPED: "border border-surface-border bg-surface-bg text-ink-700",
};

const SCAN_OUTCOME_LABEL: Record<RetentionScanRun["outcome"], string> = {
  OK: "Completed",
  SKIPPED_DISABLED: "Skipped — scanning is turned off",
  FAILED: "Failed",
};
const SCAN_OUTCOME_TINT: Record<RetentionScanRun["outcome"], string> = {
  OK: "bg-brand-green-tint text-brand-green-dark",
  SKIPPED_DISABLED: "bg-status-amber-tint text-status-amber",
  FAILED: "bg-status-red-tint text-status-red",
};

const LIFECYCLE_ACTION_LABEL: Record<PatientLifecycleEvent["action"], string> = {
  ARCHIVE: "Archived",
  RESTORE: "Restored",
  LEGAL_HOLD: "Legal hold changed",
};

// Patient.ARCHIVE_REASON_CHOICES (backend/apps/client_registry/models.py).
const ARCHIVE_REASON_LABEL: Record<string, string> = {
  RETENTION_EXPIRED: "Retention period ended",
};

const FLOOR_UNVERIFIED_APPROVAL =
  "Archiving is disabled until CITRAMAC confirms the statutory retention periods.";

function errorMessage(err: unknown, fallback: string) {
  return err instanceof ApiError ? err.message : fallback;
}

function formatDateTime(iso: string | null) {
  if (!iso) return "—";
  return new Date(iso).toLocaleString([], { dateStyle: "medium", timeStyle: "short" });
}

function formatDate(iso: string | null) {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString([], { dateStyle: "medium" });
}

/** A date-only value ("2031-04-30") — parsed as local midnight, not UTC, so it never shifts a day. */
function formatDay(day: string | null) {
  if (!day) return "—";
  return new Date(`${day}T00:00:00`).toLocaleDateString([], { dateStyle: "medium" });
}

function plural(count: number, one: string, many: string) {
  return `${count} ${count === 1 ? one : many}`;
}

function Notice({
  tone,
  icon,
  title,
  children,
}: {
  tone: "warning" | "info";
  icon: ReactNode;
  title: string;
  children: ReactNode;
}) {
  return (
    <div
      role={tone === "warning" ? "alert" : "status"}
      className={`flex items-start gap-3 rounded-lg border px-4 py-3 text-sm ${
        tone === "warning"
          ? "border-status-amber bg-status-amber-tint text-ink-900"
          : "border-surface-border bg-surface-bg text-ink-700"
      }`}
    >
      <span className="mt-0.5 flex-shrink-0 text-status-amber">{icon}</span>
      <div>
        <p className="font-semibold text-ink-900">{title}</p>
        <div className="mt-0.5 text-[12.5px] text-ink-700">{children}</div>
      </div>
    </div>
  );
}

function Pager<T>({
  page,
  data,
  noun,
  onPage,
}: {
  page: number;
  data: Paginated<T> | null;
  noun: [string, string];
  onPage: (next: number) => void;
}) {
  if (!data || data.count === 0) return null;
  return (
    <div className="flex items-center justify-between text-sm text-ink-700">
      <span>
        Page {page} · {plural(data.count, noun[0], noun[1])}
      </span>
      <div className="flex gap-2">
        <button
          type="button"
          disabled={!data.previous}
          onClick={() => onPage(Math.max(1, page - 1))}
          className="rounded-md border border-surface-border px-3 py-1.5 text-sm font-semibold text-ink-700 hover:bg-surface-bg disabled:opacity-40"
        >
          Previous
        </button>
        <button
          type="button"
          disabled={!data.next}
          onClick={() => onPage(page + 1)}
          className="rounded-md border border-surface-border px-3 py-1.5 text-sm font-semibold text-ink-700 hover:bg-surface-bg disabled:opacity-40"
        >
          Next
        </button>
      </div>
    </div>
  );
}

/**
 * Data Retention & Archive — the Org Admin's side of records retention.
 * Clinical records are never deleted: at the end of its retention period a
 * whole client record is archived (kept in full, readable, read-only) and
 * can be restored. The weekly scan only *proposes* a batch; nothing is
 * archived until an Org Admin approves it here, and the backend refuses
 * every approval until a Super Admin has confirmed the platform's statutory
 * retention floor — this screen explains that rather than hiding it.
 */
export function DataRetentionPage() {
  const { accessToken } = useAuth();
  const [tab, setTab] = useState<Tab>("Retention policy");
  const [policy, setPolicy] = useState<OrganizationRetentionPolicy | null>(null);
  const [policyLoading, setPolicyLoading] = useState(true);
  const [policyError, setPolicyError] = useState<string | null>(null);
  const [focusBatchId, setFocusBatchId] = useState<string | null>(null);

  useEffect(() => {
    if (!accessToken) return;
    getRetentionPolicy(accessToken)
      .then((data) => {
        setPolicy(data);
        setPolicyError(null);
      })
      .catch((err) => setPolicyError(errorMessage(err, "Couldn't load the retention policy.")))
      .finally(() => setPolicyLoading(false));
  }, [accessToken]);

  // null = not known (policy failed to load) — approval stays disabled then too.
  const floorVerified = policy ? policy.floor.verified : null;

  const reviewBatch = (batchId: string) => {
    setFocusBatchId(batchId);
    setTab("Archive batches");
  };

  return (
    <div className="flex flex-col gap-6 animate-fade-in">
      <div>
        <div className="mb-1.5 text-[11px] font-bold uppercase tracking-wide text-brand-green">
          Governance · Records Lifecycle
        </div>
        <h1 className="font-display text-2xl font-bold text-ink-900">
          Data Retention &amp; Archive
        </h1>
        <p className="mt-1 text-[12.5px] text-ink-500">
          Client records are archived at the end of their retention period — never deleted.
        </p>
      </div>

      {policy && !policy.floor.verified && (
        <Notice
          tone="warning"
          icon={<AlertTriangle className="h-4 w-4" />}
          title="Retention periods are provisional"
        >
          The platform minimum retention periods shown here have not yet been legally verified. They
          are provisional until CITRAMAC confirms them with legal counsel and the DHA. Scans still
          run and propose batches for you to review, but archiving is disabled until CITRAMAC
          confirms the statutory retention periods.
        </Notice>
      )}

      <div className="flex gap-1 overflow-x-auto border-b border-surface-border">
        {TABS.map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => {
              setTab(t);
              setFocusBatchId(null);
            }}
            className={`whitespace-nowrap border-b-2 px-3 py-2 text-[11px] font-bold transition-colors duration-150 ${
              tab === t
                ? "border-brand-green text-brand-green-dark"
                : "border-transparent text-ink-500 hover:text-brand-green-dark"
            }`}
          >
            {t}
          </button>
        ))}
      </div>

      {tab === "Retention policy" &&
        (policyLoading ? (
          <p className={`${CARD_CLASS} text-center text-sm text-ink-500`}>Loading…</p>
        ) : policyError || !policy ? (
          <p className={ERROR_CLASS}>{policyError ?? "Couldn't load the retention policy."}</p>
        ) : (
          <PolicySection policy={policy} onSaved={setPolicy} />
        ))}
      {tab === "Scans & forecast" && <ScansSection onReviewBatch={reviewBatch} />}
      {tab === "Archive batches" && (
        <BatchesSection floorVerified={floorVerified} initialBatchId={focusBatchId} />
      )}
      {tab === "Archived records" && <ArchivedSection />}
      {tab === "Legal holds" && <LegalHoldsSection />}
    </div>
  );
}

type PolicyForm = Record<YearsField, string> & { scan_enabled: boolean };

function formFromPolicy(policy: OrganizationRetentionPolicy): PolicyForm {
  return {
    clinical_years: policy.clinical_years === null ? "" : String(policy.clinical_years),
    mental_health_years:
      policy.mental_health_years === null ? "" : String(policy.mental_health_years),
    financial_years: policy.financial_years === null ? "" : String(policy.financial_years),
    scan_enabled: policy.scan_enabled,
  };
}

function PolicySection({
  policy,
  onSaved,
}: {
  policy: OrganizationRetentionPolicy;
  onSaved: (policy: OrganizationRetentionPolicy) => void;
}) {
  const { accessToken } = useAuth();
  const [form, setForm] = useState<PolicyForm>(() => formFromPolicy(policy));
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState(policy.updated_at);

  const save = async () => {
    if (!accessToken) return;
    setError(null);
    setFieldErrors({});
    const years = (value: string) => (value.trim() === "" ? null : Number(value));
    try {
      const updated = await updateRetentionPolicy(accessToken, {
        clinical_years: years(form.clinical_years),
        mental_health_years: years(form.mental_health_years),
        financial_years: years(form.financial_years),
        scan_enabled: form.scan_enabled,
      });
      onSaved(updated);
      setForm(formFromPolicy(updated));
      setSavedAt(updated.updated_at);
    } catch (err) {
      if (err instanceof ApiError && err.fields) {
        const next: Record<string, string> = {};
        for (const [field, messages] of Object.entries(err.fields)) {
          // eslint-disable-next-line security/detect-object-injection -- `field` is a key of the backend's own error payload, only used as a lookup key.
          next[field] = Array.isArray(messages) ? messages.join(" ") : String(messages);
        }
        setFieldErrors(next);
      }
      setError(errorMessage(err, "Couldn't save the retention policy."));
      throw err;
    }
  };

  const minorAge = policy.floor.minor_clock_start_age;

  return (
    <div className="grid animate-fade-in grid-cols-1 gap-4 lg:grid-cols-[1.5fr_1fr]">
      <section className={CARD_CLASS}>
        <h2 className={SECTION_TITLE_CLASS}>Retention periods</h2>
        <p className="mb-4 text-[12.5px] text-ink-500">
          Leave a period blank to use the platform minimum. Your organization may keep records
          longer than the minimum, never shorter.
        </p>
        <div className="flex flex-col divide-y divide-surface-border">
          {CATEGORIES.map((category) => {
            const floor = policy.floor[category.key];
            const effective = policy.effective[category.key];
            const fieldError = fieldErrors[category.field];
            return (
              <div
                key={category.key}
                className="grid grid-cols-1 gap-3 py-4 first:pt-0 last:pb-0 sm:grid-cols-[1fr_160px]"
              >
                <div>
                  <div className="text-sm font-semibold text-ink-900">{category.label}</div>
                  <div className="text-xs text-ink-500">{category.help}</div>
                  <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink-700">
                    <span>
                      Platform minimum:{" "}
                      <strong className="text-ink-900">{plural(floor, "year", "years")}</strong>
                      {!policy.floor.verified && (
                        <span className="ml-1 text-status-amber">(provisional)</span>
                      )}
                    </span>
                    <span>
                      In effect:{" "}
                      <strong className="text-ink-900">{plural(effective, "year", "years")}</strong>
                    </span>
                  </div>
                </div>
                <label className={LABEL_CLASS}>
                  Your period (years)
                  <input
                    type="number"
                    inputMode="numeric"
                    min={floor}
                    step={1}
                    className={`${FIELD_CLASS} ${fieldError ? "border-status-red" : ""}`}
                    placeholder={`${floor} (minimum)`}
                    value={form[category.field]}
                    onChange={(e) => {
                      const value = e.target.value;
                      setForm((prev) => ({ ...prev, [category.field]: value }));
                    }}
                    aria-invalid={fieldError ? true : undefined}
                  />
                  {fieldError && (
                    <span className="text-xs font-normal text-status-red">{fieldError}</span>
                  )}
                </label>
              </div>
            );
          })}
        </div>

        <label className="mt-5 flex items-start justify-between gap-3 border-t border-surface-border pt-4">
          <span className="flex flex-col">
            <span className="text-sm font-medium text-ink-900">Weekly retention scan</span>
            <span className="text-xs text-ink-500">
              When on, a weekly scan proposes an archive batch for your review. Turning it off stops
              new proposals; nothing already archived changes.
            </span>
          </span>
          <input
            type="checkbox"
            className="mt-1 h-4 w-8 shrink-0 cursor-pointer accent-brand-green"
            checked={form.scan_enabled}
            onChange={(e) => {
              const checked = e.target.checked;
              setForm((prev) => ({ ...prev, scan_enabled: checked }));
            }}
          />
        </label>

        {error && <p className={`${ERROR_CLASS} mt-4`}>{error}</p>}

        <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
          <span className="text-xs text-ink-500">Last updated {formatDateTime(savedAt)}</span>
          <SaveButton onSave={save} />
        </div>
      </section>

      <section className={CARD_CLASS}>
        <h2 className={SECTION_TITLE_CLASS}>How the retention clock works</h2>
        <p className="text-[12.5px] leading-relaxed text-ink-700">
          Each client&apos;s retention clock runs from the last activity anywhere in their record
          (or a booked future appointment, if that is later).
          {minorAge !== null &&
            ` For a client who was a minor at that point, it doesn't start before they turn ${minorAge}.`}{" "}
          Where a record holds more than one kind of information, the longest applicable period
          applies. Clients in active care or on legal hold are never proposed for archiving. Nothing
          is archived without an Org Admin&apos;s approval: the scan only proposes a batch, which
          you review and approve or reject. Archived records are kept in full — they stay readable
          but become read-only — and can be restored at any time.
        </p>
        {policy.floor.verified && policy.floor.source && (
          <p className="mt-4 rounded-md bg-surface-bg p-3 text-xs text-ink-700">
            <strong className="text-ink-900">Platform minimum confirmed against:</strong>{" "}
            {policy.floor.source}
          </p>
        )}
      </section>
    </div>
  );
}

function ScansSection({ onReviewBatch }: { onReviewBatch: (batchId: string) => void }) {
  const { accessToken } = useAuth();
  const [scans, setScans] = useState<RetentionScanRun[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [running, setRunning] = useState(false);

  useEffect(() => {
    if (!accessToken) return;
    listRetentionScans(accessToken)
      .then((data) => setScans(data.results))
      .catch((err) => setError(errorMessage(err, "Couldn't load scan history.")))
      .finally(() => setIsLoading(false));
  }, [accessToken]);

  const runNow = async () => {
    if (!accessToken) return;
    setError(null);
    setRunning(true);
    try {
      const run = await runRetentionScan(accessToken);
      setScans((prev) => [run, ...prev.filter((s) => s.id !== run.id)]);
    } catch (err) {
      setError(errorMessage(err, "Couldn't run the retention scan."));
    } finally {
      setRunning(false);
    }
  };

  const latest = scans[0] ?? null;
  const forecast = latest
    ? Object.entries(latest.forecast).sort(([a], [b]) => Number(a) - Number(b))
    : [];

  const historyColumns: ResponsiveTableColumn<RetentionScanRun>[] = [
    {
      key: "date",
      header: "Run",
      cardTitle: true,
      cell: (run) => formatDateTime(run.created_at),
    },
    {
      key: "outcome",
      header: "Outcome",
      cardBadge: true,
      cell: (run) => (
        <span className={`${BADGE_CLASS} ${SCAN_OUTCOME_TINT[run.outcome]}`}>
          {SCAN_OUTCOME_LABEL[run.outcome]}
        </span>
      ),
    },
    { key: "due", header: "Due", cell: (run) => run.due_count },
    { key: "batch", header: "Batch", cell: (run) => run.batch_reference ?? "—" },
  ];

  return (
    <div className="flex animate-fade-in flex-col gap-4">
      <section className={CARD_CLASS}>
        <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="font-display text-base font-semibold text-ink-900">Latest scan</h2>
            <p className="mt-0.5 text-[12.5px] text-ink-500">
              The scan runs weekly. Running it now proposes a batch for anything already due — it
              never archives anything by itself.
            </p>
          </div>
          <button
            type="button"
            onClick={runNow}
            disabled={running}
            className={`${BUTTON_CLASS} flex items-center gap-1.5`}
          >
            <PlayCircle className="h-4 w-4" />
            {running ? "Running…" : "Run scan now"}
          </button>
        </div>

        {error && <p className={`${ERROR_CLASS} mb-4`}>{error}</p>}

        {isLoading ? (
          <p className="text-sm text-ink-500">Loading…</p>
        ) : !latest ? (
          <p className="text-sm text-ink-500">No scan has run yet.</p>
        ) : (
          <div className="flex flex-col gap-4">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <div className="rounded-md border border-surface-border p-3">
                <div className="text-[11px] font-bold uppercase tracking-wide text-ink-500">
                  Ran
                </div>
                <div className="mt-1 text-sm font-semibold text-ink-900">
                  {formatDateTime(latest.created_at)}
                </div>
              </div>
              <div className="rounded-md border border-surface-border p-3">
                <div className="text-[11px] font-bold uppercase tracking-wide text-ink-500">
                  Outcome
                </div>
                <div className="mt-1.5">
                  <span className={`${BADGE_CLASS} ${SCAN_OUTCOME_TINT[latest.outcome]}`}>
                    {SCAN_OUTCOME_LABEL[latest.outcome]}
                  </span>
                </div>
              </div>
              <div className="rounded-md border border-surface-border p-3">
                <div className="text-[11px] font-bold uppercase tracking-wide text-ink-500">
                  Due now
                </div>
                <div className="mt-1 font-display text-xl font-bold text-ink-900">
                  {latest.outcome === "OK" ? latest.due_count : "—"}
                </div>
              </div>
            </div>

            {latest.outcome === "FAILED" && latest.error && (
              <p className={ERROR_CLASS}>{latest.error}</p>
            )}

            {latest.batch && latest.batch_reference && (
              <div className="flex flex-wrap items-center justify-between gap-3 rounded-md bg-surface-bg px-3 py-2.5 text-sm text-ink-700">
                <span>
                  Proposed batch{" "}
                  <strong className="font-mono text-ink-900">{latest.batch_reference}</strong>
                </span>
                <button
                  type="button"
                  className={LINK_BUTTON_CLASS}
                  onClick={() => latest.batch && onReviewBatch(latest.batch)}
                >
                  Review batch
                </button>
              </div>
            )}

            {latest.outcome === "OK" && (
              <div>
                <h3 className="mb-2 text-sm font-semibold text-ink-900">Coming due</h3>
                {forecast.length === 0 ? (
                  <p className="text-sm text-ink-500">No forecast windows are configured.</p>
                ) : (
                  <ul className="flex flex-col gap-1.5 text-sm text-ink-700">
                    {forecast.map(([days, count]) => (
                      <li key={days}>
                        <strong className="text-ink-900">
                          {plural(count, "record", "records")}
                        </strong>{" "}
                        within {days} days
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </div>
        )}
      </section>

      {scans.length > 1 && (
        <section>
          <h2 className="mb-3 font-display text-base font-semibold text-ink-900">Scan history</h2>
          <ResponsiveTable columns={historyColumns} rows={scans} rowKey={(run) => run.id} />
        </section>
      )}
    </div>
  );
}

function BatchesSection({
  floorVerified,
  initialBatchId,
}: {
  floorVerified: boolean | null;
  initialBatchId: string | null;
}) {
  const { accessToken } = useAuth();
  const [statusFilter, setStatusFilter] = useState<ArchiveBatchStatus | "">("");
  const [batches, setBatches] = useState<ArchiveBatch[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [openBatchId, setOpenBatchId] = useState<string | null>(initialBatchId);

  useEffect(() => {
    if (!accessToken) return;
    void Promise.resolve().then(() => {
      setIsLoading(true);
      setError(null);
      return listArchiveBatches(accessToken, statusFilter || undefined)
        .then((data) => setBatches(data.results))
        .catch((err) => setError(errorMessage(err, "Couldn't load archive batches.")))
        .finally(() => setIsLoading(false));
    });
  }, [accessToken, statusFilter]);

  const openBatch = batches.find((b) => b.id === openBatchId) ?? null;

  const columns: ResponsiveTableColumn<ArchiveBatch>[] = [
    {
      key: "reference",
      header: "Batch",
      cardTitle: true,
      cell: (batch) => (
        <span className="font-mono font-semibold text-ink-900">{batch.reference}</span>
      ),
    },
    {
      key: "created",
      header: "Proposed",
      cardSubtitle: true,
      cell: (batch) => formatDate(batch.created_at),
    },
    {
      key: "status",
      header: "Status",
      cardBadge: true,
      cell: (batch) => (
        <span className={`${BADGE_CLASS} ${BATCH_STATUS_TINT[batch.status]}`}>
          {BATCH_STATUS_LABEL[batch.status]}
        </span>
      ),
    },
    {
      key: "clients",
      header: "Clients",
      cell: (batch) =>
        batch.status === "ARCHIVED"
          ? `${batch.archived_count} archived · ${batch.skipped_count} skipped`
          : plural(batch.item_count, "client", "clients"),
    },
    {
      key: "decision",
      header: "Decision",
      cell: (batch) =>
        batch.decided_at ? (
          <>
            {batch.decided_by_name ?? "—"}
            <div className="text-[10.5px] text-ink-500">{formatDate(batch.decided_at)}</div>
          </>
        ) : (
          "—"
        ),
    },
    {
      key: "actions",
      header: "",
      hideInCard: true,
      className: "px-4 py-3 text-right",
      cell: (batch) => (
        <button type="button" className={LINK_BUTTON_CLASS}>
          {batch.status === "PENDING_APPROVAL" ? "Review" : "View"}
        </button>
      ),
    },
  ];

  return (
    <div className="flex animate-fade-in flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <select
          className={FIELD_CLASS}
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value as ArchiveBatchStatus | "")}
          aria-label="Batch status"
        >
          <option value="">All batches</option>
          <option value="PENDING_APPROVAL">Pending approval</option>
          <option value="ARCHIVED">Archived</option>
          <option value="REJECTED">Rejected</option>
        </select>
      </div>

      {floorVerified !== true && (
        <Notice
          tone="info"
          icon={<AlertTriangle className="h-4 w-4" />}
          title="Batches can be reviewed and rejected, not approved"
        >
          {floorVerified === false
            ? FLOOR_UNVERIFIED_APPROVAL
            : "Couldn't confirm whether archiving is enabled — reload the page to try again."}
        </Notice>
      )}

      {error && <p className={ERROR_CLASS}>{error}</p>}

      {isLoading ? (
        <p className={`${CARD_CLASS} text-center text-sm text-ink-500`}>Loading…</p>
      ) : (
        <ResponsiveTable
          columns={columns}
          rows={batches}
          rowKey={(batch) => batch.id}
          onRowClick={(batch) => setOpenBatchId(batch.id)}
          renderCardActions={(batch) => (
            <button
              type="button"
              className={`${LINK_BUTTON_CLASS} w-full text-center`}
              onClick={(e) => {
                e.stopPropagation();
                setOpenBatchId(batch.id);
              }}
            >
              {batch.status === "PENDING_APPROVAL" ? "Review" : "View"}
            </button>
          )}
          emptyMessage={
            statusFilter
              ? "No batches with this status."
              : "No archive batches have been proposed yet."
          }
        />
      )}

      {openBatch && (
        <BatchModal
          key={openBatch.id}
          batch={openBatch}
          floorVerified={floorVerified}
          onClose={() => setOpenBatchId(null)}
          onDecided={(updated) =>
            setBatches((prev) => prev.map((b) => (b.id === updated.id ? updated : b)))
          }
        />
      )}
    </div>
  );
}

function BatchModal({
  batch,
  floorVerified,
  onClose,
  onDecided,
}: {
  batch: ArchiveBatch;
  floorVerified: boolean | null;
  onClose: () => void;
  onDecided: (batch: ArchiveBatch) => void;
}) {
  const { accessToken } = useAuth();
  const [page, setPage] = useState(1);
  const [items, setItems] = useState<Paginated<ArchiveBatchItem> | null>(null);
  const [itemsLoading, setItemsLoading] = useState(true);
  const [itemsError, setItemsError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [decision, setDecision] = useState<"approve" | "reject" | null>(null);
  const [note, setNote] = useState("");
  const [decisionError, setDecisionError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!accessToken) return;
    void Promise.resolve().then(() => {
      setItemsLoading(true);
      setItemsError(null);
      return listArchiveBatchItems(accessToken, batch.id, page)
        .then(setItems)
        .catch((err) => setItemsError(errorMessage(err, "Couldn't load this batch's clients.")))
        .finally(() => setItemsLoading(false));
    });
  }, [accessToken, batch.id, page, reloadKey]);

  const isPending = batch.status === "PENDING_APPROVAL";
  const canApprove = floorVerified === true;

  const startDecision = (next: "approve" | "reject") => {
    setDecision(next);
    setNote("");
    setDecisionError(null);
  };

  const confirmDecision = async () => {
    if (!accessToken || !decision) return;
    if (decision === "reject" && !note.trim()) {
      setDecisionError("Say why this batch is being rejected.");
      return;
    }
    setBusy(true);
    setDecisionError(null);
    try {
      const updated =
        decision === "approve"
          ? await approveArchiveBatch(accessToken, batch.id, note.trim())
          : await rejectArchiveBatch(accessToken, batch.id, note.trim());
      onDecided(updated);
      setDecision(null);
      setReloadKey((k) => k + 1);
    } catch (err) {
      setDecisionError(
        errorMessage(
          err,
          decision === "approve" ? "Couldn't approve the batch." : "Couldn't reject the batch.",
        ),
      );
    } finally {
      setBusy(false);
    }
  };

  const columns: ResponsiveTableColumn<ArchiveBatchItem>[] = [
    {
      key: "client",
      header: "Client",
      cardTitle: true,
      cell: (item) => <span className="font-semibold text-ink-900">{item.patient_name}</span>,
    },
    {
      key: "number",
      header: "UHID / CITRAMAC no.",
      cardSubtitle: true,
      cell: (item) => (
        <span className="font-mono text-[11px]">
          {item.uhid_number || "—"} · {item.citramac_number || "—"}
        </span>
      ),
    },
    { key: "activity", header: "Last activity", cell: (item) => formatDate(item.last_activity_at) },
    {
      key: "years",
      header: "Retention",
      cell: (item) => plural(item.retention_years, "year", "years"),
    },
    { key: "ends", header: "Retention ended", cell: (item) => formatDay(item.retention_ends_on) },
    {
      key: "outcome",
      header: "Outcome",
      cardBadge: true,
      cell: (item) => (
        <div>
          <span className={`${BADGE_CLASS} ${ITEM_OUTCOME_TINT[item.outcome]}`}>
            {ITEM_OUTCOME_LABEL[item.outcome]}
          </span>
          {item.outcome === "SKIPPED" && item.skip_reason && (
            <div className="mt-1 max-w-[220px] text-[10.5px] text-ink-500">{item.skip_reason}</div>
          )}
        </div>
      ),
    },
  ];

  const footer = !isPending ? (
    <button type="button" className={GHOST_BUTTON_CLASS} onClick={onClose}>
      Close
    </button>
  ) : decision ? (
    <div className="flex w-full flex-col gap-3">
      {decision === "approve" ? (
        <p className="text-sm text-ink-700">
          <strong className="text-ink-900">
            Archive {plural(batch.item_count, "client record", "client records")}?
          </strong>{" "}
          Each archived record becomes read-only: it is kept in full and stays readable, but nothing
          can be added or changed under it. Clients whose record changed since this batch was
          proposed, who went on legal hold or who re-entered active care are skipped automatically.
          An Org Admin can restore any archived record from Data Retention &amp; Archive.
        </p>
      ) : (
        <p className="text-sm text-ink-700">
          <strong className="text-ink-900">Reject this batch?</strong> No records are archived; the
          clients stay active and may be proposed again by a later scan.
        </p>
      )}
      <label className={LABEL_CLASS}>
        {decision === "approve" ? "Note (optional)" : "Reason for rejecting (required)"}
        <textarea
          className={FIELD_CLASS}
          rows={2}
          value={note}
          onChange={(e) => setNote(e.target.value)}
        />
      </label>
      {decisionError && <p className={ERROR_CLASS}>{decisionError}</p>}
      <div className="flex flex-wrap justify-end gap-2.5">
        <button
          type="button"
          className={GHOST_BUTTON_CLASS}
          disabled={busy}
          onClick={() => setDecision(null)}
        >
          Cancel
        </button>
        {decision === "approve" ? (
          <button
            type="button"
            className={BUTTON_CLASS}
            disabled={busy || !canApprove}
            onClick={confirmDecision}
          >
            {busy ? "Archiving…" : "Confirm & archive"}
          </button>
        ) : (
          <button
            type="button"
            className={DANGER_BUTTON_CLASS}
            disabled={busy || !note.trim()}
            onClick={confirmDecision}
          >
            {busy ? "Rejecting…" : "Confirm rejection"}
          </button>
        )}
      </div>
    </div>
  ) : (
    <div className="flex w-full flex-wrap items-center justify-end gap-2.5">
      {!canApprove && (
        <p className="mr-auto text-xs text-status-amber">
          {floorVerified === false
            ? FLOOR_UNVERIFIED_APPROVAL
            : "Couldn't confirm whether archiving is enabled."}
        </p>
      )}
      <button type="button" className={DANGER_BUTTON_CLASS} onClick={() => startDecision("reject")}>
        Reject…
      </button>
      <button
        type="button"
        className={BUTTON_CLASS}
        disabled={!canApprove}
        title={canApprove ? undefined : FLOOR_UNVERIFIED_APPROVAL}
        onClick={() => startDecision("approve")}
      >
        Approve…
      </button>
    </div>
  );

  return (
    <WideModal
      open
      title={`Archive batch ${batch.reference}`}
      subtitle={`Proposed ${formatDateTime(batch.created_at)} · ${ARCHIVE_REASON_LABEL[batch.reason] ?? batch.reason} · ${BATCH_STATUS_LABEL[batch.status]}`}
      onClose={onClose}
      footer={footer}
    >
      <div className="flex flex-col gap-4">
        {batch.decided_at && (
          <div className="rounded-md bg-surface-bg p-3 text-sm text-ink-700">
            {BATCH_STATUS_LABEL[batch.status]} by{" "}
            <strong className="text-ink-900">{batch.decided_by_name ?? "—"}</strong> on{" "}
            {formatDateTime(batch.decided_at)}
            {batch.status === "ARCHIVED" &&
              ` · ${batch.archived_count} archived, ${batch.skipped_count} skipped`}
            {batch.decision_note && (
              <p className="mt-1 text-xs text-ink-500">Note: {batch.decision_note}</p>
            )}
          </div>
        )}
        {itemsError && <p className={ERROR_CLASS}>{itemsError}</p>}
        {itemsLoading && !items ? (
          <p className="text-center text-sm text-ink-500">Loading…</p>
        ) : (
          <ResponsiveTable
            columns={columns}
            rows={items?.results ?? []}
            rowKey={(item) => item.id}
            emptyMessage="This batch has no clients."
          />
        )}
        <Pager page={page} data={items} noun={["client", "clients"]} onPage={setPage} />
      </div>
    </WideModal>
  );
}

/** The client an action drawer acts on — built from either an archived-list or a registry row. */
interface RecordSubject {
  id: string;
  full_name: string;
  uhid_number: string;
  citramac_number: string;
  legal_hold: boolean;
  archived: boolean;
}

type PatientAction = { mode: "restore" | "hold" | "history"; patient: RecordSubject };

function subjectFromArchived(patient: ArchivedPatient): RecordSubject {
  return {
    id: patient.id,
    full_name: patient.full_name,
    uhid_number: patient.uhid_number,
    citramac_number: patient.citramac_number,
    legal_hold: patient.legal_hold,
    archived: true,
  };
}

function subjectFromRow(patient: PatientListRow): RecordSubject {
  return {
    id: patient.id,
    full_name: `${patient.first_name} ${patient.last_name}`.trim(),
    uhid_number: patient.uhid_number,
    citramac_number: patient.citramac_number,
    legal_hold: patient.legal_hold,
    archived: patient.archived_at !== null,
  };
}

/** Same badges as the Client Registry's Status column. */
function RecordBadges({
  archivedAt,
  legalHold,
}: {
  archivedAt: string | null;
  legalHold: boolean;
}) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {archivedAt ? (
        <span
          className="rounded-full border border-surface-border bg-surface-bg px-2.5 py-1 text-xs font-semibold text-ink-700"
          title={`Archived ${formatDate(archivedAt)} — read-only`}
        >
          Archived
        </span>
      ) : (
        <span className={`${BADGE_CLASS} bg-brand-green-tint text-brand-green-dark`}>Active</span>
      )}
      {legalHold && (
        <span className={`${BADGE_CLASS} bg-status-amber-tint text-status-amber`}>Legal hold</span>
      )}
    </div>
  );
}

function ArchivedSection() {
  const { accessToken } = useAuth();
  const [search, setSearch] = useState("");
  const [queryText, setQueryText] = useState("");
  const [page, setPage] = useState(1);
  const [data, setData] = useState<Paginated<ArchivedPatient> | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [action, setAction] = useState<PatientAction | null>(null);

  useEffect(() => {
    if (!accessToken) return;
    void Promise.resolve().then(() => {
      setIsLoading(true);
      setError(null);
      return listArchivedPatients(accessToken, queryText, page)
        .then(setData)
        .catch((err) => setError(errorMessage(err, "Couldn't load archived records.")))
        .finally(() => setIsLoading(false));
    });
  }, [accessToken, queryText, page, reloadKey]);

  const submitSearch = (event: React.FormEvent) => {
    event.preventDefault();
    setPage(1);
    setQueryText(search.trim());
  };

  const rowActions = (patient: ArchivedPatient) => (
    <>
      <button
        type="button"
        className={LINK_BUTTON_CLASS}
        onClick={() => setAction({ mode: "restore", patient: subjectFromArchived(patient) })}
      >
        Restore
      </button>
      <button
        type="button"
        className={LINK_BUTTON_CLASS}
        onClick={() => setAction({ mode: "hold", patient: subjectFromArchived(patient) })}
      >
        {patient.legal_hold ? "Release hold" : "Legal hold"}
      </button>
      <button
        type="button"
        className={LINK_BUTTON_CLASS}
        onClick={() => setAction({ mode: "history", patient: subjectFromArchived(patient) })}
      >
        History
      </button>
    </>
  );

  const columns: ResponsiveTableColumn<ArchivedPatient>[] = [
    {
      key: "client",
      header: "Client",
      cardTitle: true,
      cell: (patient) => <span className="font-semibold text-ink-900">{patient.full_name}</span>,
    },
    {
      key: "number",
      header: "UHID / CITRAMAC no.",
      cardSubtitle: true,
      cell: (patient) => (
        <span className="font-mono text-[11px]">
          {patient.uhid_number || "—"} · {patient.citramac_number || "—"}
        </span>
      ),
    },
    {
      key: "archived",
      header: "Archived",
      cell: (patient) => (
        <>
          {formatDate(patient.archived_at)}
          <div className="text-[10.5px] text-ink-500">
            {patient.archived_by_name ?? "—"}
            {patient.archive_reason &&
              ` · ${ARCHIVE_REASON_LABEL[patient.archive_reason] ?? patient.archive_reason}`}
          </div>
        </>
      ),
    },
    {
      key: "hold",
      header: "Legal hold",
      cardBadge: true,
      cell: (patient) =>
        patient.legal_hold ? (
          <span className={`${BADGE_CLASS} bg-status-amber-tint text-status-amber`}>
            Legal hold
          </span>
        ) : (
          <span className="text-ink-500">—</span>
        ),
    },
    {
      key: "actions",
      header: "",
      hideInCard: true,
      className: "px-4 py-3 text-right",
      cell: (patient) => <div className="flex justify-end gap-3">{rowActions(patient)}</div>,
    },
  ];

  return (
    <div className="flex animate-fade-in flex-col gap-4">
      <form onSubmit={submitSearch} className="flex flex-wrap items-center gap-3">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-ink-400" />
          <input
            className={`${FIELD_CLASS} w-72 pl-8`}
            placeholder="Search name, UHID or client number…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <button type="submit" className={GHOST_BUTTON_CLASS}>
          Search
        </button>
      </form>

      {error && <p className={ERROR_CLASS}>{error}</p>}

      {isLoading && !data ? (
        <p className={`${CARD_CLASS} text-center text-sm text-ink-500`}>Loading…</p>
      ) : (
        <ResponsiveTable
          columns={columns}
          rows={data?.results ?? []}
          rowKey={(patient) => patient.id}
          renderCardActions={(patient) => (
            <div className="flex w-full justify-around">{rowActions(patient)}</div>
          )}
          emptyMessage={
            queryText ? "No archived records match this search." : "No archived records."
          }
        />
      )}
      <Pager
        page={page}
        data={data}
        noun={["archived record", "archived records"]}
        onPage={setPage}
      />

      {action && (
        <PatientActionDrawer
          key={`${action.mode}-${action.patient.id}`}
          action={action}
          onClose={() => setAction(null)}
          onChanged={() => {
            setAction(null);
            setReloadKey((k) => k + 1);
          }}
        />
      )}
    </div>
  );
}

/**
 * Legal holds on any client, archived or not — Org Admins don't work in the
 * clinical chart, so this is where a hold is placed and released. Top: every
 * client currently on hold. Below: find any client and place one.
 */
function LegalHoldsSection() {
  const { accessToken } = useAuth();
  const [heldPage, setHeldPage] = useState(1);
  const [held, setHeld] = useState<Paginated<PatientListRow> | null>(null);
  const [heldLoading, setHeldLoading] = useState(true);
  const [heldError, setHeldError] = useState<string | null>(null);

  const [search, setSearch] = useState("");
  const [queryText, setQueryText] = useState("");
  const [resultsPage, setResultsPage] = useState(1);
  const [results, setResults] = useState<Paginated<PatientListRow> | null>(null);
  const [resultsLoading, setResultsLoading] = useState(false);
  const [resultsError, setResultsError] = useState<string | null>(null);

  const [reloadKey, setReloadKey] = useState(0);
  const [action, setAction] = useState<PatientAction | null>(null);

  useEffect(() => {
    if (!accessToken) return;
    void Promise.resolve().then(() => {
      setHeldLoading(true);
      setHeldError(null);
      return listPatients(accessToken, { legalHold: true, archived: "include", page: heldPage })
        .then(setHeld)
        .catch((err) => setHeldError(errorMessage(err, "Couldn't load clients on legal hold.")))
        .finally(() => setHeldLoading(false));
    });
  }, [accessToken, heldPage, reloadKey]);

  useEffect(() => {
    if (!accessToken || !queryText) return;
    void Promise.resolve().then(() => {
      setResultsLoading(true);
      setResultsError(null);
      return listPatients(accessToken, { q: queryText, archived: "include", page: resultsPage })
        .then(setResults)
        .catch((err) => setResultsError(errorMessage(err, "Couldn't search clients.")))
        .finally(() => setResultsLoading(false));
    });
  }, [accessToken, queryText, resultsPage, reloadKey]);

  const submitSearch = (event: React.FormEvent) => {
    event.preventDefault();
    const next = search.trim();
    setResultsPage(1);
    setQueryText(next);
    if (!next) setResults(null);
  };

  const baseColumns: ResponsiveTableColumn<PatientListRow>[] = [
    {
      key: "client",
      header: "Client",
      cardTitle: true,
      cell: (patient) => (
        <span className="font-semibold text-ink-900">
          {patient.first_name} {patient.last_name}
        </span>
      ),
    },
    {
      key: "number",
      header: "UHID / CITRAMAC no.",
      cardSubtitle: true,
      cell: (patient) => (
        <span className="font-mono text-[11px]">
          {patient.uhid_number || "—"} · {patient.citramac_number || "—"}
        </span>
      ),
    },
    {
      key: "status",
      header: "Status",
      cardBadge: true,
      cell: (patient) => (
        <RecordBadges archivedAt={patient.archived_at} legalHold={patient.legal_hold} />
      ),
    },
  ];

  const actionsFor = (patient: PatientListRow) => (
    <>
      <button
        type="button"
        className={LINK_BUTTON_CLASS}
        onClick={() => setAction({ mode: "hold", patient: subjectFromRow(patient) })}
      >
        {patient.legal_hold ? "Release hold" : "Place hold"}
      </button>
      <button
        type="button"
        className={LINK_BUTTON_CLASS}
        onClick={() => setAction({ mode: "history", patient: subjectFromRow(patient) })}
      >
        History
      </button>
    </>
  );

  const columns: ResponsiveTableColumn<PatientListRow>[] = [
    ...baseColumns,
    {
      key: "actions",
      header: "",
      hideInCard: true,
      className: "px-4 py-3 text-right",
      cell: (patient) => <div className="flex justify-end gap-3">{actionsFor(patient)}</div>,
    },
  ];

  const cardActions = (patient: PatientListRow) => (
    <div className="flex w-full justify-around">{actionsFor(patient)}</div>
  );

  return (
    <div className="flex animate-fade-in flex-col gap-6">
      <Notice tone="info" icon={<Scale className="h-4 w-4" />} title="What a legal hold does">
        A client record on legal hold is never proposed for archiving, and a right-to-erasure
        request cannot proceed against it, until the hold is released. A reason is required to place
        a hold, and every change is recorded in the record&apos;s history.
      </Notice>

      <section className="flex flex-col gap-3">
        <h2 className="font-display text-base font-semibold text-ink-900">Clients on legal hold</h2>
        {heldError && <p className={ERROR_CLASS}>{heldError}</p>}
        {heldLoading && !held ? (
          <p className={`${CARD_CLASS} text-center text-sm text-ink-500`}>Loading…</p>
        ) : (
          <ResponsiveTable
            columns={columns}
            rows={held?.results ?? []}
            rowKey={(patient) => patient.id}
            renderCardActions={cardActions}
            emptyMessage="No clients are on legal hold."
          />
        )}
        <Pager
          page={heldPage}
          data={held}
          noun={["client on hold", "clients on hold"]}
          onPage={setHeldPage}
        />
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="font-display text-base font-semibold text-ink-900">Place a hold</h2>
        <form onSubmit={submitSearch} className="flex flex-wrap items-center gap-3">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-ink-400" />
            <input
              className={`${FIELD_CLASS} w-72 pl-8`}
              placeholder="Name, UHID, client no. or national ID…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <button type="submit" className={GHOST_BUTTON_CLASS}>
            Search
          </button>
        </form>
        {resultsError && <p className={ERROR_CLASS}>{resultsError}</p>}
        {!queryText ? (
          <p className="text-sm text-ink-500">
            Search for any client, active or archived, to place a legal hold on their record.
          </p>
        ) : resultsLoading && !results ? (
          <p className={`${CARD_CLASS} text-center text-sm text-ink-500`}>Searching…</p>
        ) : (
          <>
            <ResponsiveTable
              columns={columns}
              rows={results?.results ?? []}
              rowKey={(patient) => patient.id}
              renderCardActions={cardActions}
              emptyMessage="No clients match this search."
            />
            <Pager
              page={resultsPage}
              data={results}
              noun={["client", "clients"]}
              onPage={setResultsPage}
            />
          </>
        )}
      </section>

      {action && (
        <PatientActionDrawer
          key={`${action.mode}-${action.patient.id}`}
          action={action}
          onClose={() => setAction(null)}
          onChanged={() => {
            setAction(null);
            setReloadKey((k) => k + 1);
          }}
        />
      )}
    </div>
  );
}

function describeDetail(key: string, value: unknown): string | null {
  if (value === null || value === undefined || value === "") return null;
  switch (key) {
    case "batch":
      return `Batch ${String(value)}`;
    case "reason":
      return `Reason: ${ARCHIVE_REASON_LABEL[String(value)] ?? String(value)}`;
    case "retention_years":
      return `Retention period: ${String(value)} years`;
    case "retention_ends_on":
      return `Retention ended ${formatDay(String(value))}`;
    case "legal_hold":
      return value === true ? "Legal hold placed" : "Legal hold released";
    default:
      return `${key.replace(/_/g, " ")}: ${String(value)}`;
  }
}

function PatientActionDrawer({
  action,
  onClose,
  onChanged,
}: {
  action: PatientAction;
  onClose: () => void;
  onChanged: () => void;
}) {
  const { accessToken } = useAuth();
  const { mode, patient } = action;
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [history, setHistory] = useState<PatientLifecycleEvent[] | null>(null);
  const [historyError, setHistoryError] = useState<string | null>(null);

  useEffect(() => {
    if (!accessToken || mode !== "history") return;
    getPatientLifecycleHistory(accessToken, patient.id)
      .then(setHistory)
      .catch((err) => setHistoryError(errorMessage(err, "Couldn't load this record's history.")));
  }, [accessToken, mode, patient.id]);

  const placingHold = mode === "hold" && !patient.legal_hold;
  const reasonRequired = mode === "restore" || placingHold;

  const submit = async () => {
    if (!accessToken) return;
    if (reasonRequired && !reason.trim()) {
      setError("A reason is required.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      if (mode === "restore") {
        await restorePatient(accessToken, patient.id, reason.trim());
      } else {
        await setPatientLegalHold(accessToken, patient.id, !patient.legal_hold, reason.trim());
      }
      onChanged();
    } catch (err) {
      setError(
        errorMessage(
          err,
          mode === "restore" ? "Couldn't restore the record." : "Couldn't update the legal hold.",
        ),
      );
    } finally {
      setBusy(false);
    }
  };

  const title =
    mode === "restore"
      ? "Restore archived record"
      : mode === "hold"
        ? patient.legal_hold
          ? "Release legal hold"
          : "Place legal hold"
        : "Record history";

  const footer =
    mode === "history" ? (
      <button type="button" className={GHOST_BUTTON_CLASS} onClick={onClose}>
        Close
      </button>
    ) : (
      <>
        <button type="button" className={GHOST_BUTTON_CLASS} disabled={busy} onClick={onClose}>
          Cancel
        </button>
        <button
          type="button"
          className={BUTTON_CLASS}
          disabled={busy || (reasonRequired && !reason.trim())}
          onClick={submit}
        >
          {busy
            ? "Saving…"
            : mode === "restore"
              ? "Confirm restore"
              : patient.legal_hold
                ? "Release hold"
                : "Place hold"}
        </button>
      </>
    );

  return (
    <Drawer
      open
      title={title}
      subtitle={`${patient.full_name} · ${patient.uhid_number || patient.citramac_number}`}
      onClose={onClose}
      footer={footer}
    >
      {mode === "restore" && (
        <div className="flex flex-col gap-4">
          <Notice
            tone="info"
            icon={<Archive className="h-4 w-4" />}
            title="The record returns to the active registry"
          >
            Staff can add to and change it again. Restoring counts as activity, so the retention
            clock starts again from today.
          </Notice>
          <label className={LABEL_CLASS}>
            Reason for restoring (required)
            <textarea
              className={FIELD_CLASS}
              rows={3}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          </label>
        </div>
      )}

      {mode === "hold" && (
        <div className="flex flex-col gap-4">
          <Notice
            tone="info"
            icon={<Scale className="h-4 w-4" />}
            title={patient.legal_hold ? "Lift the legal hold" : "Keep this record out of archiving"}
          >
            {patient.legal_hold
              ? `Once released, retention scans consider the record again and a right-to-erasure request can proceed against it.${
                  patient.archived ? " It stays archived until restored." : ""
                }`
              : "While on hold, the record is never proposed for archiving and a right-to-erasure request cannot proceed against it, until the hold is released. Use it for litigation, a regulator's request or a disputed erasure."}
          </Notice>
          <label className={LABEL_CLASS}>
            {placingHold ? "Reason for the hold (required)" : "Reason (optional)"}
            <textarea
              className={FIELD_CLASS}
              rows={3}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          </label>
        </div>
      )}

      {mode === "history" && (
        <div className="flex flex-col gap-3">
          {historyError && <p className={ERROR_CLASS}>{historyError}</p>}
          {!history && !historyError && <p className="text-sm text-ink-500">Loading…</p>}
          {history && history.length === 0 && (
            <p className="text-sm text-ink-500">No archive, restore or legal-hold events yet.</p>
          )}
          {history?.map((event, index) => (
            <div
              key={`${event.timestamp}-${index}`}
              className="flex gap-3 border-t border-surface-border pt-3 first:border-t-0 first:pt-0"
            >
              <History className="mt-0.5 h-4 w-4 flex-shrink-0 text-brand-green" />
              <div className="min-w-0">
                <div className="text-sm font-semibold text-ink-900">
                  {LIFECYCLE_ACTION_LABEL[event.action] ?? event.action}
                </div>
                <div className="text-xs text-ink-500">
                  {formatDateTime(event.timestamp)} · {event.actor_name ?? "System"}
                </div>
                <ul className="mt-1 flex flex-col gap-0.5 text-xs text-ink-700">
                  {Object.entries(event.detail)
                    .map(([key, value]) => describeDetail(key, value))
                    .filter((line): line is string => line !== null)
                    .map((line) => (
                      <li key={line} className="break-words">
                        {line}
                      </li>
                    ))}
                </ul>
              </div>
            </div>
          ))}
        </div>
      )}

      {error && <p className={`${ERROR_CLASS} mt-4`}>{error}</p>}
    </Drawer>
  );
}
