import { useEffect, useState } from "react";
import { ChevronDown, ChevronRight, Mail, RefreshCw, Send } from "lucide-react";
import { useAuth } from "../../auth/useAuth";
import { ApiError } from "../../lib/apiClient";
import {
  compileNacadaReport,
  getNacadaSettings,
  listNacadaReports,
  saveNacadaSettings,
  sendNacadaReport,
  type NacadaDeliveryStatus,
  type NacadaNdoReport,
  type NacadaSection,
  type NacadaSettings,
  type NacadaSummary,
} from "../../lib/mhpExtrasApi";
import { ConfirmDialog } from "../../components/ConfirmDialog";
import {
  Callout,
  Card,
  ErrorNote,
  PageHeader,
  StatusPill,
  type StatusTone,
} from "../care/shared/ui";
import { BTN, BTN_GHOST, BTN_SM, FIELD_LABEL, INPUT, TABLE, TD, TH } from "../care/shared/styles";

/**
 * NACADA National Drug Observatory (NDO) report — compiled per branch and
 * period from the facility's own records (apps/mhp_program/nacada_report.py).
 * Counts only; 1–4 are shown as "<5". "Send to NACADA" emails the report to
 * the organisation's NACADA reporting address (set by an Org Admin here);
 * "Send to myself" sends a test copy. Both confirm first and are audited.
 * NACADA publishes no API, so email is the only channel.
 */

type Target = "NACADA" | "SELF";

const DELIVERY: Record<Exclude<NacadaDeliveryStatus, null>, { label: string; tone: StatusTone }> = {
  PENDING: { label: "Sending", tone: "warning" },
  SENT: { label: "Sent", tone: "success" },
  FAILED: { label: "Failed", tone: "danger" },
  NOT_CONFIGURED: { label: "Email not set up", tone: "danger" },
};

function errorText(err: unknown, fallback: string) {
  return err instanceof ApiError ? err.message : fallback;
}

function isoDate(d: Date) {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** The last full calendar month — the usual reporting period. */
function lastMonth() {
  const now = new Date();
  return {
    start: isoDate(new Date(now.getFullYear(), now.getMonth() - 1, 1)),
    end: isoDate(new Date(now.getFullYear(), now.getMonth(), 0)),
  };
}

function formatDateTime(value: string) {
  return new Date(value).toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

function isSummary(data: NacadaNdoReport["summary_data"]): data is NacadaSummary {
  return Array.isArray((data as NacadaSummary).sections);
}

function SectionTable({ section }: { section: NacadaSection }) {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="text-[13px] font-bold text-ink-900">{section.title}</h3>
        {section.scope === "organization" && <StatusPill>Organisation-wide</StatusPill>}
      </div>
      <div className="overflow-x-auto rounded-lg border border-surface-border">
        <table className={TABLE}>
          <tbody>
            <tr>
              <td className={`${TD} font-semibold`}>{section.total_label}</td>
              <td className={`${TD} text-right font-semibold tabular-nums`}>
                {section.total.display}
              </td>
            </tr>
            {section.median_days && (
              <tr>
                <td className={TD}>Median wait</td>
                <td className={`${TD} text-right tabular-nums`}>{section.median_days.display}</td>
              </tr>
            )}
            {section.breakdowns.map((breakdown) => [
              <tr key={breakdown.code}>
                <th colSpan={2} className={TH}>
                  {breakdown.title}
                </th>
              </tr>,
              ...breakdown.rows.map((row) => (
                <tr key={`${breakdown.code}-${row.code}`}>
                  <td className={`${TD} pl-6`}>{row.label}</td>
                  <td
                    className={`${TD} text-right tabular-nums ${row.masked ? "text-ink-500" : ""}`}
                  >
                    {row.display}
                  </td>
                </tr>
              )),
            ])}
          </tbody>
        </table>
      </div>
      {section.notes.map((note) => (
        <p key={note} className="text-xs text-ink-500">
          {note}
        </p>
      ))}
    </div>
  );
}

function SendHistory({ report }: { report: NacadaNdoReport }) {
  if (report.sends.length === 0) return null;
  return (
    <div className="flex flex-col gap-1.5">
      <div className={FIELD_LABEL}>Sent</div>
      <ul className="flex flex-col gap-1.5">
        {report.sends.map((send) => {
          const state = send.delivery_status ? DELIVERY[send.delivery_status] : null;
          return (
            <li
              key={send.id}
              className="flex flex-wrap items-center gap-2 text-[12.5px] text-ink-700"
            >
              <span className="font-semibold text-ink-900">
                {send.target === "NACADA" ? "To NACADA" : "Test copy"}
              </span>
              <span>{send.address}</span>
              <span className="text-ink-500">
                by {send.sent_by_name}, {formatDateTime(send.sent_at)}
              </span>
              {state && <StatusPill tone={state.tone}>{state.label}</StatusPill>}
              {send.delivery_error && (
                <span className="basis-full text-xs text-status-red">{send.delivery_error}</span>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/** Where the report stands with NACADA, from the latest NACADA send's delivery. */
function NacadaStatus({ report, hasSummary }: { report: NacadaNdoReport; hasSummary: boolean }) {
  if (!hasSummary) return <StatusPill>Old format</StatusPill>;
  const toNacada = report.sends.filter((s) => s.target === "NACADA");
  if (toNacada.some((s) => s.delivery_status === "SENT")) {
    return <StatusPill tone="success">Sent to NACADA</StatusPill>;
  }
  const latest = toNacada[0];
  if (!latest) return <StatusPill>Not sent to NACADA</StatusPill>;
  if (latest.delivery_status === "PENDING") {
    return <StatusPill tone="warning">Sending to NACADA</StatusPill>;
  }
  return <StatusPill tone="danger">NACADA send failed</StatusPill>;
}

function ReportCard({
  report,
  settings,
  onSend,
}: {
  report: NacadaNdoReport;
  settings: NacadaSettings | null;
  onSend: (report: NacadaNdoReport, target: Target) => void;
}) {
  const [open, setOpen] = useState(false);
  const summary = isSummary(report.summary_data) ? report.summary_data : null;
  const canSend = Boolean(settings?.can_send && summary);
  const noNacadaAddress = !settings?.nacada_report_email;

  return (
    <div className="rounded-lg border border-surface-border">
      <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          className="flex min-w-0 items-center gap-2 text-left"
        >
          {open ? (
            <ChevronDown aria-hidden="true" className="h-4 w-4 flex-none text-ink-500" />
          ) : (
            <ChevronRight aria-hidden="true" className="h-4 w-4 flex-none text-ink-500" />
          )}
          <span className="text-[13px] font-semibold text-ink-900">
            {report.period_start} to {report.period_end}
          </span>
          <span className="text-[12.5px] text-ink-500">
            {report.branch_name || "No branch"} · compiled {formatDateTime(report.generated_at)}
            {report.generated_by_name ? ` by ${report.generated_by_name}` : ""}
          </span>
        </button>
        <NacadaStatus report={report} hasSummary={summary !== null} />
      </div>

      {open && (
        <div className="flex flex-col gap-5 border-t border-surface-border px-4 py-4">
          {summary ? (
            <>
              <p className="text-xs text-ink-500">{summary.definition_label}</p>
              <div className="grid gap-5 lg:grid-cols-2">
                {summary.sections.map((section) => (
                  <SectionTable key={section.code} section={section} />
                ))}
              </div>
              <div className="flex flex-col gap-1">
                {summary.notes.map((note) => (
                  <p key={note} className="text-xs text-ink-500">
                    {note}
                  </p>
                ))}
              </div>
            </>
          ) : (
            <Callout tone="info" label="Old format">
              This report was compiled before the current indicators and can&rsquo;t be sent.
              Compile the same period again to send it.
            </Callout>
          )}

          <SendHistory report={report} />

          {canSend && (
            <div className="flex flex-wrap items-center gap-2">
              <button type="button" className={BTN_GHOST} onClick={() => onSend(report, "SELF")}>
                <Mail aria-hidden="true" className="h-4 w-4" />
                Send to myself
              </button>
              <button
                type="button"
                className={BTN}
                disabled={noNacadaAddress}
                onClick={() => onSend(report, "NACADA")}
              >
                <Send aria-hidden="true" className="h-4 w-4" />
                Send to NACADA
              </button>
              {noNacadaAddress && (
                <span className="text-xs text-ink-500">
                  An Org Admin needs to set the NACADA reporting email first.
                </span>
              )}
            </div>
          )}
          {summary && settings && !settings.can_send && (
            <p className="text-xs text-ink-500">
              You don&rsquo;t have permission to send this report. An Org Admin can give it to your
              role in Roles &amp; Permissions (&ldquo;Send the NACADA NDO report&rdquo;).
            </p>
          )}
        </div>
      )}
    </div>
  );
}

function NacadaEmailCard({
  settings,
  onSaved,
}: {
  settings: NacadaSettings;
  onSaved: (s: NacadaSettings) => void;
}) {
  const { accessToken } = useAuth();
  const [value, setValue] = useState(settings.nacada_report_email);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!accessToken) return;
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      const next = await saveNacadaSettings(accessToken, value.trim());
      onSaved(next);
      setSaved(true);
    } catch (err) {
      setError(errorText(err, "Couldn't save the NACADA reporting email."));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card title="NACADA reporting email">
      {settings.can_edit ? (
        <form onSubmit={save} className="flex flex-col gap-3">
          <p className="text-[12.5px] text-ink-700">
            &ldquo;Send to NACADA&rdquo; emails the report here. Use the NDO reporting address
            NACADA has given your facility.
          </p>
          <div className="flex flex-wrap items-end gap-2">
            <label className="flex min-w-[16rem] flex-1 flex-col gap-1.5">
              <span className={FIELD_LABEL}>Email address</span>
              <input
                type="email"
                className={INPUT}
                value={value}
                onChange={(e) => {
                  setValue(e.target.value);
                  setSaved(false);
                }}
                placeholder="Not set"
              />
            </label>
            <button type="submit" className={BTN} disabled={busy}>
              {busy ? "Saving…" : "Save"}
            </button>
          </div>
          {saved && (
            <p role="status" className="text-xs text-brand-green-dark">
              Saved.
            </p>
          )}
          <ErrorNote>{error}</ErrorNote>
        </form>
      ) : (
        <p className="text-[13px] text-ink-900">
          {settings.nacada_report_email || (
            <span className="text-ink-500">Not set. An Org Admin can add it on this page.</span>
          )}
        </p>
      )}
    </Card>
  );
}

function fetchAll(accessToken: string) {
  return Promise.all([listNacadaReports(accessToken), getNacadaSettings(accessToken)]);
}

export function NacadaReportPage() {
  const { accessToken } = useAuth();
  const [initial] = useState(lastMonth);
  const [periodStart, setPeriodStart] = useState(initial.start);
  const [periodEnd, setPeriodEnd] = useState(initial.end);
  const [branch, setBranch] = useState("");
  const [reports, setReports] = useState<NacadaNdoReport[]>([]);
  const [settings, setSettings] = useState<NacadaSettings | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [compileError, setCompileError] = useState<string | null>(null);
  const [compiling, setCompiling] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [pending, setPending] = useState<{ report: NacadaNdoReport; target: Target } | null>(null);
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);

  const branches = settings?.branches ?? [];
  // The picker starts on the branch being worked at; viewing all branches,
  // the user must pick one — a report is always for one facility.
  const chosenBranch = branch || settings?.working_branch || "";

  const apply = ([list, config]: Awaited<ReturnType<typeof fetchAll>>) => {
    setReports(list.results);
    setSettings(config);
  };

  useEffect(() => {
    if (!accessToken) return;
    fetchAll(accessToken)
      .then(([list, config]) => {
        setReports(list.results);
        setSettings(config);
      })
      .catch((err) => setLoadError(errorText(err, "Couldn't load NACADA reports.")));
  }, [accessToken]);

  const refresh = async () => {
    if (!accessToken) return;
    setRefreshing(true);
    setLoadError(null);
    try {
      apply(await fetchAll(accessToken));
    } catch (err) {
      setLoadError(errorText(err, "Couldn't load NACADA reports."));
    } finally {
      setRefreshing(false);
    }
  };

  const compile = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!accessToken) return;
    setCompiling(true);
    setCompileError(null);
    try {
      const report = await compileNacadaReport(accessToken, {
        period_start: periodStart,
        period_end: periodEnd,
        ...(chosenBranch ? { branch: chosenBranch } : {}),
      });
      setReports((current) => [report, ...current]);
    } catch (err) {
      setCompileError(errorText(err, "Couldn't compile the report."));
    } finally {
      setCompiling(false);
    }
  };

  const confirmSend = async () => {
    if (!accessToken || !pending) return;
    setSending(true);
    setSendError(null);
    try {
      const updated = await sendNacadaReport(accessToken, pending.report.id, pending.target);
      setReports((current) => current.map((r) => (r.id === updated.id ? updated : r)));
      setPending(null);
    } catch (err) {
      setSendError(errorText(err, "Couldn't send the report."));
    } finally {
      setSending(false);
    }
  };

  const pendingSummary =
    pending && isSummary(pending.report.summary_data) ? pending.report.summary_data : null;
  const pendingWhat = pendingSummary
    ? `${pendingSummary.branch_name}, ${pendingSummary.period_start} to ${pendingSummary.period_end}`
    : "";

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        eyebrow="Reports & analytics"
        title="NACADA NDO report"
        subtitle="National Drug Observatory reporting, compiled from this facility's records"
      />

      <Callout tone="info" label="How it works">
        The indicators are facility-defined and not yet matched to NACADA&rsquo;s official NDO
        template. Only counts are included, with no names, identifiers or notes. Counts of 1–4 are
        shown as &ldquo;&lt;5&rdquo;. Where a total would give a small count away, another count is
        withheld too.
      </Callout>

      {loadError && <ErrorNote>{loadError}</ErrorNote>}

      {settings && <NacadaEmailCard settings={settings} onSaved={setSettings} />}

      <Card title="Compile a report">
        <form onSubmit={compile} className="flex flex-col gap-3">
          <div className="flex flex-wrap items-end gap-3">
            {branches.length > 1 && (
              <label className="flex flex-col gap-1.5">
                <span className={FIELD_LABEL}>Branch</span>
                <select
                  className={INPUT}
                  value={chosenBranch}
                  onChange={(e) => setBranch(e.target.value)}
                  required
                >
                  <option value="" disabled>
                    Choose a branch
                  </option>
                  {branches.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.name}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <label className="flex flex-col gap-1.5">
              <span className={FIELD_LABEL}>Period start</span>
              <input
                type="date"
                className={INPUT}
                value={periodStart}
                onChange={(e) => setPeriodStart(e.target.value)}
                required
              />
            </label>
            <label className="flex flex-col gap-1.5">
              <span className={FIELD_LABEL}>Period end</span>
              <input
                type="date"
                className={INPUT}
                value={periodEnd}
                onChange={(e) => setPeriodEnd(e.target.value)}
                required
              />
            </label>
            <button type="submit" disabled={compiling} className={BTN}>
              {compiling ? "Compiling…" : "Compile"}
            </button>
          </div>
          <ErrorNote>{compileError}</ErrorNote>
        </form>
      </Card>

      <Card
        title="Compiled reports"
        aside={
          <button
            type="button"
            className={`${BTN_GHOST} ${BTN_SM}`}
            onClick={refresh}
            disabled={refreshing}
          >
            <RefreshCw
              aria-hidden="true"
              className={`h-3.5 w-3.5 ${refreshing ? "animate-spin" : ""}`}
            />
            Refresh
          </button>
        }
      >
        <div className="flex flex-col gap-3">
          {reports.map((report) => (
            <ReportCard
              key={report.id}
              report={report}
              settings={settings}
              onSend={(r, target) => {
                setSendError(null);
                setPending({ report: r, target });
              }}
            />
          ))}
          {reports.length === 0 && <p className="text-sm text-ink-500">No reports compiled yet.</p>}
        </div>
      </Card>

      <ConfirmDialog
        open={pending !== null}
        title={
          pending?.target === "NACADA"
            ? "Send this report to NACADA?"
            : "Send a test copy to yourself?"
        }
        confirmLabel={pending?.target === "NACADA" ? "Send to NACADA" : "Send test copy"}
        busyLabel="Sending…"
        busy={sending}
        error={sendError}
        onConfirm={confirmSend}
        onCancel={() => setPending(null)}
      >
        {pending?.target === "NACADA" ? (
          <>
            <p>
              The report for <strong>{pendingWhat}</strong> will be emailed to{" "}
              <strong>{settings?.nacada_report_email}</strong>.
            </p>
            <p>
              You&rsquo;ll get a copy at {settings?.my_email}, and replies from NACADA come to you.
              An email can&rsquo;t be recalled once it has gone. The send is recorded in the audit
              log.
            </p>
          </>
        ) : (
          <p>
            The report for <strong>{pendingWhat}</strong> will be emailed to{" "}
            <strong>{settings?.my_email}</strong>, marked as a test copy. It is not sent to NACADA.
          </p>
        )}
      </ConfirmDialog>
    </div>
  );
}
