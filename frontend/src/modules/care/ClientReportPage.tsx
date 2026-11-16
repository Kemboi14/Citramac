import { createContext, Fragment, useContext, useEffect, useState, type ReactNode } from "react";
import { Link, useParams } from "react-router-dom";
import { ChevronDown, ClipboardList, FolderOpen, Loader2, Lock } from "lucide-react";
import { useAuth } from "../../auth/useAuth";
import { DocumentActions } from "../../components/DocumentActions";
import { ApiError } from "../../lib/apiClient";
import {
  getClientReport,
  type ClientReport,
  type ClientReportIntake,
  type ClientReportTriage,
  type ReportRow,
} from "../../lib/carePathwayApi";
import { RegistrationDetailsDrawer } from "../clinical/RegistrationDetailsDrawer";
import { clientRecordPath } from "./shared/recordRoutes";
import { BTN_GHOST } from "./shared/styles";
import { ErrorNote, PageHeader, PriorityPill } from "./shared/ui";

/**
 * Everything recorded for one client, read-only: registration, every triage
 * and intake (first to latest), care plan, admissions, interventions with
 * their records, group sessions, outcomes, discharges, signed notes and
 * follow-up. Compiled by the server each time it is opened (nothing stored)
 * and audited; content the reader may not see is marked as withheld. Preview
 * and Download PDF use the same compiler, so the page and the document agree.
 */
export function ClientReportPage() {
  const { patientId = "" } = useParams();
  const { accessToken } = useAuth();
  const [loaded, setLoaded] = useState<{ id: string; report: ClientReport } | null>(null);
  const [error, setError] = useState<{ id: string; message: string } | null>(null);

  useEffect(() => {
    if (!accessToken || !patientId) return;
    let cancelled = false;
    getClientReport(accessToken, patientId)
      .then((report) => {
        if (!cancelled) setLoaded({ id: patientId, report });
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        const message =
          err instanceof ApiError && err.status === 403
            ? "The full client report is for clinical staff. Ask a clinician if you need it."
            : err instanceof ApiError
              ? err.message
              : "Couldn't load the client report.";
        setError({ id: patientId, message });
      });
    return () => {
      cancelled = true;
    };
  }, [accessToken, patientId]);

  const report = loaded?.id === patientId ? loaded.report : null;
  const failed = error?.id === patientId ? error.message : null;

  if (failed) {
    return (
      <div className="animate-fade-in">
        <PageHeader eyebrow="Clients" title="Client report" />
        <ErrorNote>{failed}</ErrorNote>
        <Link to="/clinical/registry" className={`${BTN_GHOST} mt-4 inline-flex`}>
          Back to clients
        </Link>
      </div>
    );
  }
  if (!report) {
    return (
      <div className="animate-fade-in">
        <PageHeader eyebrow="Clients" title="Client report" />
        <p role="status" className="flex items-center gap-2 text-sm text-ink-500">
          <Loader2 aria-hidden className="h-4 w-4 animate-spin" /> Compiling the report…
        </p>
      </div>
    );
  }

  return (
    <PatientContext.Provider value={report.client.id}>
      <ClientFiles report={report} />
    </PatientContext.Provider>
  );
}

type TabKey =
  | "overview"
  | "triage"
  | "intake"
  | "plan"
  | "interventions"
  | "inpatient"
  | "outcomes"
  | "billing"
  | "notes"
  | "activity";

type InterventionFilter =
  "psychiatry" | "psychotherapy" | "family" | "groups" | "care-plan" | "mse";

type SessionRecord = ClientReport["interventions"][number]["records"][number];

const isPsychiatry = (type: string) => /psychiatr/i.test(type);
const isFamily = (title: string) => /family|couple/i.test(title);

/** The client's files in one flat, professional layout: patient card, tabs
 * over the record areas, tables that open into detail, and an overview panel
 * with the actions on the right. */
function ClientFiles({ report }: { report: ClientReport }) {
  const c = report.client;
  const [tab, setTab] = useState<TabKey>("overview");
  const [filter, setFilter] = useState<InterventionFilter>("psychotherapy");
  const [showDetails, setShowDetails] = useState(false);

  const sessions = report.interventions.find((g) => g.id === "psychotherapy")?.records ?? [];
  const individual = sessions.filter((r) => !isFamily(r.title));
  const family = sessions.filter((r) => isFamily(r.title));
  const carePlanActions = report.interventions.filter((g) => g.id !== "psychotherapy");
  const psychiatryNotes = report.notes.filter((n) => isPsychiatry(n.type));
  const otherNotes = report.notes.filter((n) => !isPsychiatry(n.type));
  const latestTriage = report.triages[report.triages.length - 1];
  const openAdmission = report.admissions.find((a) => !a.discharged_on);
  const primaryDiagnosis =
    report.clinical.diagnoses.find((d) => d.kind === "Primary") ?? report.clinical.diagnoses[0];

  const tabs: { key: TabKey; label: string; count?: number }[] = [
    { key: "overview", label: "Overview" },
    { key: "triage", label: "Triage", count: report.triages.length },
    { key: "intake", label: "Intake", count: report.intakes.length },
    { key: "plan", label: "Care plan" },
    {
      key: "interventions",
      label: "Interventions",
      count:
        sessions.length +
        psychiatryNotes.length +
        report.group_sessions.length +
        carePlanActions.length,
    },
    { key: "inpatient", label: "Inpatient", count: report.admissions.length },
    { key: "outcomes", label: "Outcomes", count: report.outcomes.summary.length },
    { key: "billing", label: "Billing", count: report.billing.services.length },
    { key: "notes", label: "Notes & follow-up", count: otherNotes.length },
    { key: "activity", label: "Activity log", count: report.activity.length },
  ];

  const filters: { key: InterventionFilter; label: string; count: number }[] = [
    { key: "psychotherapy", label: "Psychotherapy", count: individual.length },
    { key: "psychiatry", label: "Psychiatric reviews", count: psychiatryNotes.length },
    { key: "family", label: "Family & couple", count: family.length },
    { key: "groups", label: "Group sessions", count: report.group_sessions.length },
    { key: "care-plan", label: "Care-plan actions", count: carePlanActions.length },
    { key: "mse", label: "Mental status exam", count: report.mse ? 1 : 0 },
  ];

  return (
    <div className="animate-fade-in">
      {/* Title and breadcrumb */}
      <div className="mb-4">
        <h1 className="font-display text-[22px] font-bold text-ink-900">Client report</h1>
        <nav aria-label="Breadcrumb" className="mt-0.5 text-[13px] text-ink-500">
          <Link to="/clinical/registry" className="hover:text-ink-900">
            Clients
          </Link>
          <span className="mx-2">›</span>
          <span className="font-semibold text-brand-green-dark">{c.name}</span>
        </nav>
      </div>

      <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_300px]">
        <div className="min-w-0">
          {/* Patient card + priority card */}
          <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_200px]">
            <section className="flex flex-wrap items-center gap-5 rounded-lg border border-surface-border bg-surface-card px-5 py-4">
              <div
                aria-hidden
                className="flex h-16 w-16 shrink-0 items-center justify-center rounded-lg bg-brand-green-tint text-xl font-bold text-brand-green-dark"
              >
                {initials(c.name)}
              </div>
              <dl className="grid min-w-0 flex-1 grid-cols-2 gap-x-6 gap-y-2.5 sm:grid-cols-4">
                <Fact label="Client ID" value={c.citramac_number || "—"} mono />
                <Fact
                  label="Age / sex"
                  value={
                    [c.age != null ? `${c.age}y` : "", c.sex].filter(Boolean).join(" · ") || "—"
                  }
                />
                <Fact label="Date of birth" value={c.date_of_birth || "—"} />
                <Fact
                  label={openAdmission ? "Ward / bed" : "Setting"}
                  value={
                    openAdmission
                      ? [openAdmission.ward, openAdmission.bed].filter(Boolean).join(" · ") ||
                        "Admitted"
                      : report.registration.setting_label || "Outpatient"
                  }
                />
                <div className="col-span-2">
                  <Fact label="Client name" value={c.name} strong />
                </div>
                <Fact label="Registered" value={report.registration.registered_on || "—"} />
                <Fact label="Episode" value={report.episode?.status_label || "None open"} />
              </dl>
            </section>
            <section className="flex flex-col items-center justify-center rounded-lg border border-surface-border bg-surface-card px-4 py-4 text-center">
              <div className="text-[11px] font-bold uppercase tracking-wide text-ink-500">
                Current priority
              </div>
              <div className="mt-2">
                {report.clinical.priority ? (
                  <PriorityPill priority={report.clinical.priority} />
                ) : (
                  <span className="text-[15px] font-semibold text-ink-500">Not set</span>
                )}
              </div>
              {latestTriage && (
                <div className="mt-2 text-[11.5px] text-ink-500">
                  Last triage {latestTriage.arrival_on}
                </div>
              )}
            </section>
          </div>

          {/* Tabs and content */}
          <section className="mt-4 rounded-lg border border-surface-border bg-surface-card">
            <div
              role="tablist"
              aria-label="Record areas"
              className="flex overflow-x-auto border-b border-surface-border px-2"
            >
              {tabs.map((t) => {
                const active = t.key === tab;
                return (
                  <button
                    key={t.key}
                    type="button"
                    role="tab"
                    aria-selected={active}
                    onClick={() => setTab(t.key)}
                    className={`-mb-px whitespace-nowrap border-b-2 px-3.5 py-3 text-[13.5px] font-semibold transition-colors ${
                      active
                        ? "border-brand-green text-brand-green-dark"
                        : "border-transparent text-ink-700 hover:text-ink-900"
                    }`}
                  >
                    {t.label}
                    {t.count ? (
                      <span className="ml-1.5 rounded bg-surface-bg px-1.5 py-0.5 text-[11px] text-ink-500">
                        {t.count}
                      </span>
                    ) : null}
                  </button>
                );
              })}
            </div>
            <div role="tabpanel" className="p-4">
              {tab === "overview" && <OverviewTab report={report} />}
              {tab === "triage" && (
                <ExpandTable
                  empty="No triage recorded."
                  head={["Date", "Priority", "Presenting concern", "Signed by"]}
                  rows={[...report.triages].reverse().map((t, index) => ({
                    id: t.id,
                    cells: [
                      t.arrival_on,
                      t.priority ? <PriorityPill key="p" priority={t.priority} /> : "Not set",
                      t.presenting_concern,
                      t.signed ? `${t.signed_by}` : "Not signed",
                    ],
                    detail: <TriageEntry triage={t} number={report.triages.length - index} />,
                  }))}
                />
              )}
              {tab === "intake" && (
                <ExpandTable
                  empty="No intake recorded."
                  head={["Intake", "Status", "Risk", "Decision", "Signed"]}
                  rows={[...report.intakes].reverse().map((i, index) => ({
                    id: i.id,
                    cells: [
                      `Intake ${report.intakes.length - index}`,
                      i.status,
                      i.risk_level,
                      i.clinical_decision,
                      i.signed_on ? `${i.signed_on} · ${i.signed_by}` : `Saved ${i.saved_on}`,
                    ],
                    detail: <IntakeEntry intake={i} number={report.intakes.length - index} />,
                  }))}
                />
              )}
              {tab === "plan" && <PlanTab report={report} />}
              {tab === "interventions" && (
                <>
                  <div className="mb-4 flex flex-wrap gap-2">
                    {filters.map((f) => (
                      <button
                        key={f.key}
                        type="button"
                        aria-pressed={f.key === filter}
                        onClick={() => setFilter(f.key)}
                        className={`rounded-md border px-3 py-1.5 text-[12.5px] font-semibold transition-colors ${
                          f.key === filter
                            ? "border-brand-green bg-brand-green text-on-primary"
                            : "border-surface-border bg-surface-card text-ink-700 hover:border-brand-green"
                        }`}
                      >
                        {f.label} <span className="opacity-75">{f.count}</span>
                      </button>
                    ))}
                  </div>
                  {filter === "psychotherapy" && (
                    <SessionTable records={individual} empty="No psychotherapy sessions." />
                  )}
                  {filter === "family" && (
                    <SessionTable records={family} empty="No family or couple sessions." />
                  )}
                  {filter === "psychiatry" && (
                    <NoteTable notes={psychiatryNotes} empty="No psychiatric reviews signed." />
                  )}
                  {filter === "groups" && (
                    <ExpandTable
                      empty="No group sessions."
                      head={["Date", "Session", "Facilitator", "Attendance"]}
                      rows={[...report.group_sessions].reverse().map((g) => ({
                        id: g.id,
                        cells: [
                          g.on,
                          [g.topic, g.category].filter(Boolean).join(" · "),
                          g.facilitator,
                          g.attendance,
                        ],
                        detail: <GroupSheet group={g} />,
                      }))}
                    />
                  )}
                  {filter === "care-plan" && (
                    <ExpandTable
                      empty="No care-plan actions."
                      head={["Action", "Module", "Status", "Records"]}
                      rows={carePlanActions.map((g) => ({
                        id: g.id,
                        cells: [g.title, g.module, g.status_label, String(g.records.length)],
                        detail: <ActionSheet action={g} />,
                      }))}
                    />
                  )}
                  {filter === "mse" &&
                    (report.mse ? (
                      <MseSheet mse={report.mse} />
                    ) : (
                      <Empty>No mental status exam recorded.</Empty>
                    ))}
                </>
              )}
              {tab === "inpatient" && <InpatientTab report={report} />}
              {tab === "outcomes" && <OutcomesTab report={report} />}
              {tab === "billing" && <BillingTab report={report} />}
              {tab === "activity" && (
                <Table
                  head={["When", "Area", "What", "Detail"]}
                  rows={report.activity.map((x) => [x.on, x.kind, x.title, x.detail])}
                  empty="Nothing recorded yet."
                />
              )}
              {tab === "notes" && (
                <>
                  <NoteTable notes={otherNotes} empty="No signed notes." />
                  <SubHeading>Follow-up</SubHeading>
                  <Table
                    head={["When", "Reason", "Status", "With"]}
                    rows={report.follow_ups.map((f) => [
                      f.scheduled_for,
                      f.reason,
                      f.status,
                      f.provider,
                    ])}
                    empty="No follow-up booked."
                  />
                  <SubHeading>Appointments</SubHeading>
                  <Table
                    head={["When", "Type", "With", "Status"]}
                    rows={report.appointments.map((x) => [x.on, x.type, x.provider, x.status])}
                    empty="No appointments."
                  />
                </>
              )}
            </div>
          </section>
        </div>

        {/* Right column: overview and actions */}
        <aside className="grid gap-4">
          <section className="overflow-hidden rounded-lg border border-surface-border bg-surface-card">
            <div className="bg-brand-green px-4 py-2.5 text-[12px] font-bold uppercase tracking-wide text-on-primary">
              Clinical overview
            </div>
            <dl className="divide-y divide-surface-border px-4 text-[13px]">
              <OverviewLine label="Triages" value={report.triages.length} />
              <OverviewLine label="Intakes" value={report.intakes.length} />
              <OverviewLine label="Therapy sessions" value={sessions.length} />
              <OverviewLine label="Psychiatric reviews" value={psychiatryNotes.length} />
              <OverviewLine label="Group sessions" value={report.group_sessions.length} />
              <OverviewLine label="Admissions" value={report.admissions.length} />
              <div className="flex items-center justify-between py-2">
                <dt className="font-semibold text-ink-900">Balance due</dt>
                <dd className="font-bold text-status-red">
                  {report.billing.totals.outstanding || "—"}
                </dd>
              </div>
            </dl>
            <div className="border-t border-surface-border px-4 py-3">
              <div className="text-[11px] font-bold uppercase tracking-wide text-ink-500">
                Primary diagnosis
              </div>
              <div className="mt-1 text-[13px] font-semibold text-ink-900">
                {primaryDiagnosis
                  ? `${primaryDiagnosis.code ? `${primaryDiagnosis.code} · ` : ""}${primaryDiagnosis.label}`
                  : "None recorded"}
              </div>
            </div>
          </section>

          <section className="rounded-lg border border-surface-border bg-surface-card px-4 py-3">
            <div className="text-[12px] font-bold uppercase tracking-wide text-brand-green-dark">
              Safety
            </div>
            <SubHeading>Active alerts</SubHeading>
            {report.clinical.alerts.length ? (
              <ul className="grid gap-1.5">
                {report.clinical.alerts.map((a) => (
                  <li
                    key={a.code + a.raised_on}
                    className="rounded-md border-l-[3px] border-status-amber bg-status-amber-tint px-2.5 py-1.5 text-[12.5px] text-ink-900"
                  >
                    {a.label}
                    <span className="block text-[11px] text-ink-500">Raised {a.raised_on}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <Empty>None.</Empty>
            )}
            <SubHeading>Allergies</SubHeading>
            {report.clinical.allergies.length ? (
              <ul className="grid gap-1.5">
                {report.clinical.allergies.map((a) => (
                  <li
                    key={a.substance}
                    className="rounded-md border-l-[3px] border-status-red bg-status-red-tint px-2.5 py-1.5 text-[12.5px] text-ink-900"
                  >
                    {a.substance}
                    {a.reaction && (
                      <span className="block text-[11px] text-ink-500">{a.reaction}</span>
                    )}
                  </li>
                ))}
              </ul>
            ) : (
              <Empty>None recorded.</Empty>
            )}
          </section>

          <section className="rounded-lg border border-surface-border bg-surface-card px-4 py-3">
            <div className="mb-2 text-[12px] font-bold uppercase tracking-wide text-brand-green-dark">
              Full report
            </div>
            <DocumentActions
              path={`/care/clients/${c.id}/report/print/`}
              filename={`client-report-${c.citramac_number || c.id.slice(0, 8)}`}
              label={`Client report — ${c.name}`}
            />
          </section>

          <div className="grid grid-cols-2 gap-3">
            <ActionTile
              icon={<ClipboardList className="h-5 w-5" />}
              onClick={() => setShowDetails(true)}
            >
              Registration details
            </ActionTile>
            <ActionTile
              icon={<FolderOpen className="h-5 w-5" />}
              to={clientRecordPath(c.id, "snapshot")}
            >
              Open client record
            </ActionTile>
          </div>
          <p className="text-[11.5px] leading-5 text-ink-500">
            Read-only · compiled {report.generated_on} for {report.generated_by} ·{" "}
            {report.reference}. This view is logged. Content you may not see is marked as withheld.
          </p>
        </aside>
      </div>
      <RegistrationDetailsDrawer
        patientId={showDetails ? c.id : null}
        onClose={() => setShowDetails(false)}
      />
    </div>
  );
}

function OverviewTab({ report }: { report: ClientReport }) {
  const r = report.registration;
  return (
    <>
      <Rows
        rows={[
          { label: "Phone", value: r.phone },
          {
            label: "Next of kin",
            value: [
              r.next_of_kin,
              r.next_of_kin_relationship && `(${r.next_of_kin_relationship})`,
              r.next_of_kin_phone,
            ]
              .filter(Boolean)
              .join(" "),
          },
          { label: "Address", value: r.address },
          { label: "Payer", value: r.payer },
          { label: "Referral source", value: r.referral_source },
          { label: "Branch", value: r.branch },
          { label: "Care coordinator", value: report.episode?.care_manager ?? "" },
          { label: "Responsible clinician", value: report.clinical.clinician },
          { label: "Presenting problems", value: report.episode?.presenting_problems ?? "" },
        ]}
      />
      <SubHeading>Diagnoses</SubHeading>
      <Table
        head={["Code", "Diagnosis", "Type", "Certainty", "Noted"]}
        rows={report.clinical.diagnoses.map((d) => [
          d.code,
          d.label,
          d.kind,
          d.certainty,
          d.noted_on,
        ])}
        empty="No diagnoses recorded."
      />
      <SubHeading>Prescribed medicines</SubHeading>
      <Table
        head={["Medicine", "Dose", "Route", "Frequency", "Prescribed"]}
        rows={report.clinical.medicines.map((m) => [
          m.drug,
          m.dose,
          m.route,
          m.frequency,
          `${m.prescribed_on} · ${m.prescribed_by}`,
        ])}
        empty="No prescriptions."
      />
    </>
  );
}

function PlanTab({ report }: { report: ClientReport }) {
  const printPath = usePartPrint("plan");
  const p = report.care_plan;
  if (!p) return <Empty>No care plan yet.</Empty>;
  return (
    <RecordSheet
      title={`Care plan · version ${p.version}`}
      meta={[
        ["Confirmed", p.confirmed_on ? `${p.confirmed_on} · ${p.confirmed_by}` : ""],
        ["Coordinator", p.care_coordinator],
        ["Review", p.review_date],
      ]}
      status={
        p.confirmed_on
          ? { label: "Confirmed", tone: "signed" }
          : { label: "Not confirmed", tone: "draft" }
      }
      printPath={printPath}
      filename="care-plan"
    >
      <SheetSection
        title="Plan"
        rows={[
          { label: "Goals", value: p.goals },
          { label: "What matters to the client", value: p.what_matters },
          { label: "Rationale", value: p.rationale },
          { label: "Client agreement", value: p.client_agreement },
        ]}
      />
    </RecordSheet>
  );
}

function BillingTab({ report }: { report: ClientReport }) {
  const b = report.billing;
  const printPath = usePartPrint("billing");
  return (
    <RecordSheet
      title="Billing summary"
      meta={[
        ["Payer", b.payer],
        [
          "Invoice",
          b.invoice ? `${b.invoice.number} v${b.invoice.version} · ${b.invoice.issued_on}` : "",
        ],
      ]}
      printPath={printPath}
      filename="billing-summary"
    >
      <div className="grid gap-3 sm:grid-cols-3">
        <Figure label="Total services" value={b.totals.services} />
        <Figure label="Paid" value={b.totals.paid} tone="green" />
        <Figure label="Outstanding" value={b.totals.outstanding} tone="red" />
      </div>
      {b.invoice?.stale && (
        <p className="text-[12.5px] text-status-amber">
          Services have changed since the invoice was issued; a new version is due.
        </p>
      )}
      <SheetSection title="Services delivered">
        <Table
          head={["Date", "Service", "Status", "Amount"]}
          rows={b.services.map((x) => [x.on, x.service, x.status, x.amount])}
          empty="No services charged."
        />
      </SheetSection>
      <SheetSection title="Payments">
        <Table
          head={["Date", "Reference", "Method", "Amount", "Received by"]}
          rows={b.payments.map((x) => [x.on, x.reference, x.method, x.amount, x.received_by])}
          empty="No payments."
        />
      </SheetSection>
      <SheetSection title="Claims">
        <Table
          head={["Claim", "Payer", "Status", "Claimed", "Submitted"]}
          rows={b.claims.map((x) => [x.number, x.payer, x.status, x.claimed, x.submitted_on])}
          empty="No claims."
        />
      </SheetSection>
    </RecordSheet>
  );
}

function Figure({ label, value, tone }: { label: string; value: string; tone?: "green" | "red" }) {
  return (
    <div className="rounded-md border border-surface-border px-3 py-2.5">
      <div className="text-[11.5px] text-ink-500">{label}</div>
      <div
        className={`mt-0.5 text-[17px] font-bold ${
          tone === "green"
            ? "text-brand-green-dark"
            : tone === "red"
              ? "text-status-red"
              : "text-ink-900"
        }`}
      >
        {value || "—"}
      </div>
    </div>
  );
}

function InpatientTab({ report }: { report: ClientReport }) {
  return (
    <>
      <ExpandTable
        empty="Never admitted."
        head={["Admitted", "Discharged", "Ward / bed", "Consultant", "Status"]}
        rows={[...report.admissions].reverse().map((a) => ({
          id: a.id,
          cells: [
            a.admitted_on,
            a.discharged_on || "—",
            [a.ward, a.bed].filter(Boolean).join(" · "),
            a.consultant,
            a.status,
          ],
          detail: <AdmissionSheet admission={a} />,
        }))}
      />
      <SubHeading>Discharge summaries</SubHeading>
      <ExpandTable
        empty="No discharge summary."
        head={["Version", "Discharged", "Status", "Signed"]}
        rows={report.discharges.map((d) => ({
          id: String(d.version),
          cells: [
            `Version ${d.version}`,
            d.discharged_on || "—",
            d.status,
            d.signed_on ? `${d.signed_on} · ${d.signed_by}` : "—",
          ],
          detail: <DischargeSheet discharge={d} />,
        }))}
      />
    </>
  );
}

function OutcomesTab({ report }: { report: ClientReport }) {
  const o = report.outcomes;
  return (
    <>
      <ExpandTable
        empty="No outcome measures recorded."
        head={["Measure", "Baseline", "Latest", "Change"]}
        rows={o.summary.map((m) => ({
          id: m.instrument,
          cells: [
            m.name,
            `${m.baseline} · ${m.baseline_on}`,
            <span key="l" className="font-semibold">
              {m.latest}
              {m.max ? ` / ${m.max}` : ""}
              {m.band ? ` · ${m.band}` : ""}
            </span>,
            <span
              key="c"
              className={
                m.direction === "bad"
                  ? "font-semibold text-status-red"
                  : m.direction === "good"
                    ? "font-semibold text-brand-green-dark"
                    : "text-ink-700"
              }
            >
              {m.change}
            </span>,
          ],
          detail: <OutcomeSheet measure={m} />,
        }))}
      />
      {o.episode_outcome && (
        <Para label="Episode outcome">
          {o.episode_outcome.outcome}
          {o.episode_outcome.destination && ` — ${o.episode_outcome.destination}`} (
          {o.episode_outcome.recorded_on})
        </Para>
      )}
    </>
  );
}

function SessionTable({ records, empty }: { records: SessionRecord[]; empty: string }) {
  return (
    <ExpandTable
      empty={empty}
      head={["Session", "Date", "Type", "Clinician"]}
      rows={records.map((r, index) => ({
        id: r.id,
        cells: [`${records.length - index}`, r.on, r.title, r.provider],
        detail: <SessionSheet record={r} number={records.length - index} />,
      }))}
    />
  );
}

function NoteTable({ notes, empty }: { notes: ClientReport["notes"]; empty: string }) {
  return (
    <ExpandTable
      empty={empty}
      head={["Date", "Type", "Author"]}
      rows={notes.map((n) => ({
        id: n.id,
        cells: [n.on, n.type, n.by],
        detail: <NoteSheet note={n} />,
      }))}
    />
  );
}

function RecordBody({ record }: { record: SessionRecord }) {
  if (record.restricted) return <Withheld>{record.restricted}</Withheld>;
  return (
    <>
      {record.note && <p className="whitespace-pre-wrap text-[13px] text-ink-900">{record.note}</p>}
      {record.details.map((d) => (
        <Para key={d.label} label={d.label}>
          {d.value}
        </Para>
      ))}
      {record.response && <Para label="Response">{record.response}</Para>}
      {record.outcome && <Para label="Outcome">{record.outcome}</Para>}
      {record.next_action && <Para label="Next">{record.next_action}</Para>}
      {!record.note && !record.details.length && !record.response && !record.outcome && (
        <Empty>No detail recorded.</Empty>
      )}
    </>
  );
}

function SessionSheet({ record: r, number }: { record: SessionRecord; number: number }) {
  const printPath = usePartPrint("session", r.id);
  return (
    <RecordSheet
      title={`Session ${number} · ${r.title || "Session"}`}
      meta={[
        ["Date", r.on],
        ["Clinician", r.provider],
      ]}
      printPath={r.restricted ? undefined : printPath}
      filename={`session-${number}`}
    >
      <RecordBody record={r} />
    </RecordSheet>
  );
}

function NoteSheet({ note: n }: { note: ClientReport["notes"][number] }) {
  const printPath = usePartPrint("note", n.id);
  return (
    <RecordSheet
      title={n.type}
      meta={[
        ["Signed", n.on],
        ["Author", n.by],
      ]}
      status={{ label: "Signed", tone: "signed" }}
      printPath={printPath}
      filename="clinical-note"
    >
      <p className="whitespace-pre-wrap text-[13px] leading-6 text-ink-900">{n.text}</p>
    </RecordSheet>
  );
}

function GroupSheet({ group: g }: { group: ClientReport["group_sessions"][number] }) {
  const printPath = usePartPrint("group", g.id);
  return (
    <RecordSheet
      title={g.topic || "Group session"}
      meta={[
        ["Date", g.on],
        ["Facilitator", g.facilitator],
      ]}
      printPath={printPath}
      filename="group-session"
    >
      <SheetSection
        title="Session"
        rows={[
          { label: "Category", value: g.category },
          { label: "Attendance", value: g.attendance },
          { label: "Observation", value: g.observation || "None recorded." },
        ]}
      />
    </RecordSheet>
  );
}

function ActionSheet({ action: g }: { action: ClientReport["interventions"][number] }) {
  const printPath = usePartPrint("action", g.id);
  return (
    <RecordSheet
      title={g.title}
      meta={[
        ["Module", g.module],
        ["Records", String(g.records.length)],
      ]}
      status={g.status_label ? { label: g.status_label, tone: "neutral" } : undefined}
      printPath={printPath}
      filename="intervention"
    >
      <SheetSection
        title="Plan"
        rows={[
          { label: "Goal", value: g.goal },
          { label: "Instructions", value: g.instructions },
          {
            label: g.note ? `Plan note · ${g.note.on} · ${g.note.by}` : "Plan note",
            value: g.note?.text ?? "",
          },
        ]}
      />
      <SheetSection title={`Delivery records (${g.records.length})`}>
        {g.records.length === 0 && <Empty>Nothing delivered yet.</Empty>}
        <ol className="divide-y divide-surface-border">
          {g.records.map((r) => (
            <li key={r.id} className="py-2">
              <div className="text-[12.5px] font-semibold text-ink-900">
                {r.on}
                {r.provider && ` · ${r.provider}`}
              </div>
              <RecordBody record={r} />
            </li>
          ))}
        </ol>
      </SheetSection>
    </RecordSheet>
  );
}

function MseSheet({ mse }: { mse: NonNullable<ClientReport["mse"]> }) {
  const printPath = usePartPrint("mse");
  return (
    <RecordSheet
      title="Mental status examination"
      meta={[
        ["Recorded", mse.recorded_on],
        ["By", mse.recorded_by],
      ]}
      printPath={printPath}
      filename="mental-status-exam"
    >
      <SheetSection title="Examination" rows={mse.fields} />
      {mse.risk.length > 0 && (
        <SheetSection title="Risk">
          <List items={mse.risk} />
        </SheetSection>
      )}
    </RecordSheet>
  );
}

function AdmissionSheet({ admission: a }: { admission: ClientReport["admissions"][number] }) {
  const printPath = usePartPrint("admission", a.id);
  return (
    <RecordSheet
      title="Admission"
      meta={[
        ["Admitted", a.admitted_on],
        ["Discharged", a.discharged_on],
        ["Ward / bed", [a.ward, a.bed].filter(Boolean).join(" · ")],
      ]}
      status={{ label: a.status, tone: a.discharged_on ? "neutral" : "signed" }}
      printPath={printPath}
      filename="admission"
    >
      <SheetSection
        title="Admission"
        rows={[
          { label: "Consultant", value: a.consultant },
          { label: "Reason", value: a.reason },
          { label: "Primary diagnosis", value: a.primary_diagnosis },
        ]}
      />
      <SheetSection
        title="Risk"
        rows={[
          { label: "Risks", value: a.risks.join(", ") },
          { label: "Risk summary", value: a.risk_summary },
        ]}
      />
    </RecordSheet>
  );
}

function DischargeSheet({ discharge: d }: { discharge: ClientReport["discharges"][number] }) {
  return (
    <RecordSheet
      title={`Discharge summary · version ${d.version}`}
      meta={[
        ["Discharged", d.discharged_on],
        ["Signed", d.signed_on ? `${d.signed_on} · ${d.signed_by}` : ""],
      ]}
      status={
        d.signed_on ? { label: "Signed", tone: "signed" } : { label: d.status, tone: "draft" }
      }
      printPath={d.printable ? `/care/discharges/${d.id}/print/` : undefined}
      filename={`discharge-v${d.version}`}
    >
      {d.restricted ? (
        <Withheld>{d.restricted}</Withheld>
      ) : (
        <SheetSection
          title="Discharge"
          rows={[
            {
              label: "Disposition",
              value: [d.disposition, d.destination].filter(Boolean).join(" — "),
            },
            { label: "Clinical status", value: d.clinical_status },
            { label: "Treatment summary", value: d.treatment_summary },
          ]}
        />
      )}
    </RecordSheet>
  );
}

function OutcomeSheet({ measure: m }: { measure: ClientReport["outcomes"]["summary"][number] }) {
  const printPath = usePartPrint("outcome", m.instrument);
  return (
    <RecordSheet
      title={m.name}
      meta={[
        ["Latest", `${m.latest}${m.max ? ` / ${m.max}` : ""} · ${m.latest_on}`],
        ["Baseline", `${m.baseline} · ${m.baseline_on}`],
      ]}
      printPath={printPath}
      filename={`outcome-${m.instrument}`}
    >
      <SheetSection
        title="Summary"
        rows={[
          { label: "Band", value: m.band },
          { label: "Change since baseline", value: m.change },
        ]}
      />
      <SheetSection title="Every score">
        <Table
          head={["Date", "Score"]}
          rows={[...m.series].reverse().map((point) => [point.on, String(point.score)])}
          empty="No scores."
        />
      </SheetSection>
    </RecordSheet>
  );
}

/** A flat table whose rows open to show their detail underneath. */
function ExpandTable({
  head,
  rows,
  empty,
}: {
  head: string[];
  rows: { id: string; cells: ReactNode[]; detail: ReactNode }[];
  empty: string;
}) {
  const [open, setOpen] = useState<string | null>(null);
  if (!rows.length) return <Empty>{empty}</Empty>;
  return (
    <div className="overflow-x-auto rounded-md border border-surface-border">
      <table className="w-full border-collapse text-left text-[13px]">
        <thead className="bg-surface-bg">
          <tr className="text-[11.5px] font-semibold text-ink-700">
            {head.map((h) => (
              <th key={h} className="px-3 py-2.5">
                {h}
              </th>
            ))}
            <th className="w-10 px-3 py-2.5">
              <span className="sr-only">Details</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const expanded = open === row.id;
            return (
              <Fragment key={row.id}>
                <tr
                  className={`cursor-pointer border-t border-surface-border transition-colors ${
                    expanded ? "bg-brand-green-tint" : "hover:bg-surface-bg"
                  }`}
                  onClick={() => setOpen(expanded ? null : row.id)}
                >
                  {row.cells.map((cell, index) => (
                    <td key={index} className="px-3 py-2.5 align-top text-ink-900">
                      {cell || "—"}
                    </td>
                  ))}
                  <td className="px-3 py-2.5 text-right">
                    <button
                      type="button"
                      aria-expanded={expanded}
                      aria-label={expanded ? "Hide details" : "Show details"}
                      onClick={(event) => {
                        event.stopPropagation();
                        setOpen(expanded ? null : row.id);
                      }}
                      className="rounded p-0.5 text-ink-500 hover:text-ink-900"
                    >
                      <ChevronDown
                        aria-hidden
                        className={`h-4 w-4 transition-transform ${expanded ? "rotate-180" : ""}`}
                      />
                    </button>
                  </td>
                </tr>
                {expanded && (
                  <tr className="border-t border-surface-border bg-surface-bg">
                    <td colSpan={head.length + 1} className="px-3 py-3">
                      {row.detail}
                    </td>
                  </tr>
                )}
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function Fact({
  label,
  value,
  mono,
  strong,
}: {
  label: string;
  value: string;
  mono?: boolean;
  strong?: boolean;
}) {
  return (
    <div className="min-w-0">
      <dt className="text-[11px] font-semibold text-ink-500">{label}</dt>
      <dd
        className={`truncate text-[13.5px] text-ink-900 ${mono ? "font-mono" : ""} ${
          strong ? "font-bold uppercase tracking-wide" : "font-semibold"
        }`}
      >
        {value}
      </dd>
    </div>
  );
}

function OverviewLine({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex items-center justify-between py-2">
      <dt className="text-ink-700">{label}</dt>
      <dd className="font-semibold text-ink-900">{value}</dd>
    </div>
  );
}

function ActionTile({
  icon,
  children,
  onClick,
  to,
}: {
  icon: ReactNode;
  children: ReactNode;
  onClick?: () => void;
  to?: string;
}) {
  const cls =
    "flex flex-col items-center gap-2 rounded-lg border border-surface-border bg-surface-card px-2 py-3.5 text-center text-[12.5px] font-semibold text-ink-900 transition-colors hover:border-brand-green";
  const inner = (
    <>
      <span className="flex h-9 w-9 items-center justify-center rounded-md bg-brand-green-tint text-brand-green-dark">
        {icon}
      </span>
      {children}
    </>
  );
  return to ? (
    <Link to={to} className={cls}>
      {inner}
    </Link>
  ) : (
    <button type="button" onClick={onClick} className={cls}>
      {inner}
    </button>
  );
}

const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("") || "?";

/** The client whose records are on the page, for each record's printout. */
const PatientContext = createContext("");

/** The printout of one record of this client (client_report_views PARTS). */
function usePartPrint(part: string, item = "") {
  const patientId = useContext(PatientContext);
  const query = new URLSearchParams({ part, item }).toString();
  return `/care/clients/${patientId}/report/print/?${query}`;
}

/**
 * One record laid out like a printed form: a header strip with what it is,
 * when, by whom and its status, the record's own Print / PDF, then labelled
 * sections.
 */
function RecordSheet({
  title,
  meta,
  status,
  printPath,
  filename,
  children,
}: {
  title: string;
  meta: [string, string][];
  status?: { label: string; tone: "signed" | "draft" | "neutral" };
  printPath?: string;
  filename?: string;
  children: ReactNode;
}) {
  const shownMeta = meta.filter(([, value]) => value);
  return (
    <article className="overflow-hidden rounded-md border border-surface-border bg-surface-card">
      <header className="flex flex-wrap items-start justify-between gap-3 border-b border-surface-border bg-surface-bg px-4 py-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-[14.5px] font-bold text-ink-900">{title}</h3>
            {status && (
              <span
                className={`rounded px-1.5 py-0.5 text-[10.5px] font-bold uppercase tracking-wide ${
                  status.tone === "signed"
                    ? "bg-brand-green-tint text-brand-green-dark"
                    : status.tone === "draft"
                      ? "bg-status-amber-tint text-status-amber"
                      : "bg-surface-card text-ink-700"
                }`}
              >
                {status.label}
              </span>
            )}
          </div>
          {shownMeta.length > 0 && (
            <dl className="mt-1 flex flex-wrap text-[12px] text-ink-700">
              {shownMeta.map(([label, value], index) => (
                <div
                  key={label}
                  className={`flex gap-1 ${index ? "ml-3 border-l border-surface-border pl-3" : ""}`}
                >
                  <dt className="text-ink-500">{label}</dt>
                  <dd className="font-medium">{value}</dd>
                </div>
              ))}
            </dl>
          )}
        </div>
        {printPath && (
          <DocumentActions path={printPath} filename={filename ?? "record"} label={title} />
        )}
      </header>
      <div className="grid gap-4 px-4 py-4">{children}</div>
    </article>
  );
}

/** A titled block of label / value lines inside a record sheet. */
function SheetSection({
  title,
  rows,
  children,
}: {
  title: string;
  rows?: ReportRow[];
  children?: ReactNode;
}) {
  const shown = (rows ?? []).filter((row) => row.value);
  if (!shown.length && !children) return null;
  return (
    <section>
      <h4 className="mb-1.5 border-b-2 border-brand-green/30 pb-1 text-[11.5px] font-bold uppercase tracking-wide text-brand-green-dark">
        {title}
      </h4>
      {shown.length > 0 && <Rows rows={shown} />}
      {children}
    </section>
  );
}

function TriageEntry({ triage: t, number }: { triage: ClientReportTriage; number: number }) {
  return (
    <RecordSheet
      title={`Triage ${number}`}
      meta={[
        ["Arrived", t.arrival_on],
        ["Signed", t.signed ? `${t.signed_on} · ${t.signed_by}` : ""],
        ["Rules", t.rules_version],
      ]}
      status={t.signed ? { label: "Signed", tone: "signed" } : { label: t.status, tone: "draft" }}
      printPath={t.assessment_id ? `/care/assessments/${t.assessment_id}/print/` : undefined}
      filename={`triage-${number}`}
    >
      <SheetSection
        title="Decision"
        rows={[
          { label: "Priority", value: t.final_priority || t.priority_label },
          { label: "Recommendation", value: t.recommendation },
          { label: "Reasons", value: t.recommendation_reasons },
          { label: "Priority override", value: t.override_reason },
          { label: "Presenting concern", value: t.presenting_concern },
        ]}
      />
      {(t.findings.length > 0 || t.alerts.length > 0) && (
        <SheetSection title="Findings & alerts">
          <List items={[...t.alerts.map((a) => `Alert: ${a}`), ...t.findings]} />
        </SheetSection>
      )}
      {t.answers.map((section) => (
        <SheetSection key={section.title} title={section.title} rows={section.rows} />
      ))}
      {t.rechecks.length > 0 && (
        <SheetSection title="Re-checks">
          <Table
            head={["Signed", "By", "Change", "Distress", "Note"]}
            rows={t.rechecks.map((r) => [r.signed_on, r.signed_by, r.change, r.distress, r.note])}
            empty=""
          />
        </SheetSection>
      )}
      {!t.signed && <Empty>Not signed yet; the full answers appear once it is signed.</Empty>}
    </RecordSheet>
  );
}

function IntakeEntry({ intake: i, number }: { intake: ClientReportIntake; number: number }) {
  const printPath = usePartPrint("intake", i.id);
  return (
    <RecordSheet
      title={`Intake ${number}${i.version > 1 ? ` · version ${i.version}` : ""}`}
      meta={[
        ["Recorded", `${i.saved_on}${i.author ? ` · ${i.author}` : ""}`],
        ["Signed", i.signed_on ? `${i.signed_on} · ${i.signed_by}` : ""],
        ["Completeness", i.completeness],
      ]}
      status={
        i.signed_on ? { label: "Signed", tone: "signed" } : { label: i.status, tone: "draft" }
      }
      printPath={printPath}
      filename={`intake-${number}`}
    >
      <SheetSection
        title="Summary"
        rows={[
          { label: "Presenting concern", value: i.presenting_concern },
          { label: "History", value: i.history },
          { label: "Risk", value: [i.risk_level, i.risk_notes].filter(Boolean).join(" — ") },
          { label: "Formulation", value: i.formulation },
          { label: "Clinical decision", value: i.clinical_decision },
        ]}
      />
      {i.sections.map((section) => (
        <SheetSection key={section.title} title={section.title} rows={section.rows} />
      ))}
      {i.outstanding.length > 0 && (
        <SheetSection title="Outstanding at the time">
          <List items={i.outstanding.map(String)} />
        </SheetSection>
      )}
    </RecordSheet>
  );
}

/** Label / value lines with hairlines between them, like a printed form. */
function Rows({ rows }: { rows: ReportRow[] }) {
  const shown = rows.filter((row) => row.value);
  if (!shown.length) return null;
  return (
    <dl className="divide-y divide-surface-border">
      {shown.map((row) => (
        <div
          key={row.label}
          className="grid gap-x-6 gap-y-0.5 py-1.5 sm:grid-cols-[minmax(160px,220px)_1fr]"
        >
          <dt className="text-[12.5px] text-ink-500">{row.label}</dt>
          <dd className="whitespace-pre-wrap break-words text-[13px] text-ink-900">{row.value}</dd>
        </div>
      ))}
    </dl>
  );
}

function Table({ head, rows, empty }: { head: string[]; rows: string[][]; empty: string }) {
  if (!rows.length) return <Empty>{empty}</Empty>;
  return (
    <div className="overflow-x-auto rounded-md border border-surface-border">
      <table className="w-full border-collapse text-left text-[13px]">
        <thead className="bg-surface-bg">
          <tr className="text-[11.5px] font-semibold text-ink-700">
            {head.map((h) => (
              <th key={h} className="px-3 py-2.5">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr key={index} className="border-t border-surface-border">
              {row.map((cell, cellIndex) => (
                <td key={cellIndex} className="px-3 py-2.5 align-top text-ink-900">
                  {cell || "—"}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function List({ items, empty }: { items: string[]; empty?: string }) {
  if (!items.length) return empty ? <Empty>{empty}</Empty> : null;
  return (
    <ul className="list-disc space-y-0.5 pl-5 text-[13px] text-ink-900">
      {items.map((item, index) => (
        <li key={index}>{item}</li>
      ))}
    </ul>
  );
}

function SubHeading({ children }: { children: ReactNode }) {
  return (
    <h4 className="mb-1 mt-3 text-[11px] font-bold uppercase tracking-wide text-ink-500">
      {children}
    </h4>
  );
}

function Para({ label, children }: { label: string; children: ReactNode }) {
  return (
    <p className="mt-1 whitespace-pre-wrap text-[13px] text-ink-900">
      <span className="font-semibold text-ink-500">{label}: </span>
      {children}
    </p>
  );
}

function Empty({ children }: { children: ReactNode }) {
  return <p className="text-[13px] text-ink-500">{children}</p>;
}

function Withheld({ children }: { children: ReactNode }) {
  return (
    <p className="mt-1 flex items-center gap-1.5 text-[13px] italic text-ink-500">
      <Lock aria-hidden className="h-3.5 w-3.5" />
      {children}
    </p>
  );
}
