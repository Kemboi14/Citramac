import { useEffect, useState } from "react";
import { useAuth } from "../../../../auth/useAuth";
import { confirmPlan, getPlanWorkspace, listCosign, type CosignRow, type PlanWorkspace } from "../../../../lib/carePathwayApi";
import { formatDateTime } from "../../shared/format";
import { BTN } from "../../shared/styles";
import { Callout, ErrorNote, PageHeader, Tag } from "../../shared/ui";
import { errorText } from "../../triage/helpers";
import { DocumentedActions } from "../CarePlanStage";
import type { RecordViewProps } from "../types";
import { ClientTab } from "./ClientTab";
import { DecisionsTab } from "./DecisionsTab";
import { TasksTab } from "./TasksTab";

const TABS = [
  { key: "decisions", label: "Decisions" },
  { key: "client", label: "With the client" },
  { key: "tasks", label: "Tasks & reviews" },
  { key: "documented", label: "Documented actions" },
] as const;
type TabKey = (typeof TABS)[number]["key"];

/** Care Plan — decisions · with the client · tasks. Findings recommend; the
 * clinician accepts, modifies or declines; signing creates an immutable version. */
export function CarePlanStage(props: RecordViewProps) {
  const { patientId, onRecordChanged } = props;
  const { accessToken } = useAuth();
  const [ws, setWs] = useState<PlanWorkspace | null>(null);
  const [cosign, setCosign] = useState<CosignRow[]>([]);
  const [tab, setTab] = useState<TabKey>("decisions");
  const [error, setError] = useState<string | null>(null);
  const [signing, setSigning] = useState(false);

  useEffect(() => {
    if (!accessToken) return;
    let cancelled = false;
    Promise.all([getPlanWorkspace(accessToken, patientId), listCosign(accessToken, patientId)])
      .then(([w, c]) => {
        if (cancelled) return;
        setWs(w);
        setCosign(c.results);
      })
      .catch((e) => !cancelled && setError(errorText(e, "Couldn't load the care plan.")));
    return () => {
      cancelled = true;
    };
  }, [accessToken, patientId]);

  async function sign() {
    if (!accessToken) return;
    setSigning(true);
    setError(null);
    try {
      setWs(await confirmPlan(accessToken, patientId));
      setCosign((await listCosign(accessToken, patientId)).results);
      onRecordChanged();
    } catch (e) {
      const outstanding = (e as { fields?: { outstanding?: string[] } })?.fields?.outstanding;
      setError(outstanding?.length ? `Cannot sign yet — ${outstanding.length} item(s) to complete: ${outstanding.join("; ")}` : errorText(e, "Couldn't sign the plan."));
    } finally {
      setSigning(false);
    }
  }

  if (!ws) {
    return (
      <div>
        <PageHeader title="Care Plan" subtitle="Findings recommend — the clinician decides" />
        {error ? <ErrorNote>{error}</ErrorNote> : <p className="text-[13px] text-ink-500">Loading…</p>}
      </div>
    );
  }
  return (
    <div>
      <PageHeader
        title="Care Plan"
        subtitle={ws.version ? `Version ${ws.version} signed ${ws.confirmed_at ? formatDateTime(ws.confirmed_at) : ""} by ${ws.confirmed_by}` : "Not yet signed — findings recommend, the clinician decides"}
        actions={
          <button type="button" className={BTN} disabled={signing} onClick={() => void sign()}>
            {signing ? "Signing…" : ws.version ? "Sign a new version" : "Sign care plan"}
          </button>
        }
      />
      <ErrorNote>{error}</ErrorNote>
      {ws.outstanding.length > 0 && (
        <Callout tone="warning" className="mb-3">
          <strong>{ws.outstanding.length} item(s) before the plan can be signed:</strong>
          <ul className="mt-1 list-disc pl-5">
            {ws.outstanding.map((o) => (
              <li key={o}>{o}</li>
            ))}
          </ul>
        </Callout>
      )}
      {cosign.map((c) => (
        <Callout key={c.id} tone={c.status === "DECLINED" ? "danger" : c.status === "SIGNED" ? "success" : "warning"} className="mb-2" role="status">
          <strong>Senior co-signature {c.status === "REQUESTED" ? "requested" : c.status === "SIGNED" ? "given" : c.status.toLowerCase()}:</strong> {c.what}{" "}
          <Tag>by {c.requested_by}</Tag>
          {c.decline_reason && <span> — reason: “{c.decline_reason}”</span>}
          {c.thread.length > 0 && <span> — discussion: “{c.thread[c.thread.length - 1].note}”</span>}
        </Callout>
      ))}
      <div role="tablist" aria-label="Care plan sections" className="mb-4 flex flex-wrap gap-1.5 border-b border-surface-border">
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            role="tab"
            aria-selected={tab === t.key}
            onClick={() => setTab(t.key)}
            className={`-mb-px border-b-2 px-3 py-[9px] text-[13px] font-semibold ${tab === t.key ? "border-brand-green text-ink-900" : "border-transparent text-ink-500 hover:text-ink-900"}`}
          >
            {t.label}
          </button>
        ))}
      </div>
      {tab === "decisions" && <DecisionsTab patientId={patientId} ws={ws} onChange={setWs} disabled={false} />}
      {tab === "client" && <ClientTab patientId={patientId} ws={ws} onChange={setWs} disabled={false} />}
      {tab === "tasks" && (
        <TasksTab
          patientId={patientId}
          ws={ws}
          onTaskChanged={(action) => setWs({ ...ws, actions: ws.actions.map((a) => (a.id === action.id ? action : a)) })}
        />
      )}
      {tab === "documented" && <DocumentedActions {...props} />}
    </div>
  );
}
