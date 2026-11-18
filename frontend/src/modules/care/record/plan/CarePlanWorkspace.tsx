import { useEffect, useState } from "react";
import { AutoResizeTextarea } from "../../shared/AutoResizeTextarea";
import { useAuth } from "../../../../auth/useAuth";
import {
  getPlanWorkspace,
  listCosign,
  listSeniors,
  updatePlanDetails,
  type CosignRow,
  type PlanWorkspace,
} from "../../../../lib/carePathwayApi";
import { confirmPlanReviewed } from "../../../../lib/carePlanOutcomesApi";
import { formatDateTime } from "../../shared/format";
import { BTN, BTN_GHOST, FIELD_LABEL, INPUT } from "../../shared/styles";
import { ErrorNote, PageHeader } from "../../shared/ui";
import { errorText } from "../../triage/helpers";
import type { RecordViewProps } from "../types";
import { DecisionsTab } from "./DecisionsTab";

/** Care Plan — one screen: the suggested actions to accept, modify or decline,
 * and — only when the plan conflicts with the client's
 * risk — the rationale and senior reviewer. Accepted actions are delivered and
 * tracked in Interventions (the safety plan included). Signing creates an
 * immutable version. */
export function CarePlanStage(props: RecordViewProps) {
  const { patientId, onRecordChanged } = props;
  const { accessToken } = useAuth();
  const [ws, setWs] = useState<PlanWorkspace | null>(null);
  const [cosign, setCosign] = useState<CosignRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [signing, setSigning] = useState(false);
  const [reviewing, setReviewing] = useState(false);
  const [bulkReviewed, setBulkReviewed] = useState(false);

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

  const bulk = ws?.actions.filter((a) => a.bulk_accepted && a.decision !== "DECLINED") ?? [];

  function startSigning() {
    // Bulk-accepted actions are listed again for review before signing (RULE-05).
    if (bulk.length) {
      setBulkReviewed(false);
      setReviewing(true);
      return;
    }
    void sign();
  }

  async function sign() {
    if (!accessToken) return;
    setSigning(true);
    setError(null);
    try {
      setWs(await confirmPlanReviewed(accessToken, patientId, bulk.length > 0 && bulkReviewed));
      setReviewing(false);
      setCosign((await listCosign(accessToken, patientId)).results);
      onRecordChanged();
    } catch (e) {
      const outstanding = (e as { fields?: { outstanding?: string[] } })?.fields?.outstanding;
      setError(
        outstanding?.length
          ? `Cannot sign yet — ${outstanding.length} item(s) to complete: ${outstanding.join("; ")}`
          : errorText(e, "Couldn't sign the plan."),
      );
    } finally {
      setSigning(false);
    }
  }

  if (!ws) {
    return (
      <div>
        <PageHeader title="Care plan" />
        {error ? (
          <ErrorNote>{error}</ErrorNote>
        ) : (
          <p className="text-[13px] text-ink-500">Loading…</p>
        )}
      </div>
    );
  }

  const ready = ws.outstanding.length === 0;
  const planCosign = cosign.filter((c) => c.kind.startsWith("CARE_PLAN"));
  const intakeNote =
    ws.intake.state === "partial"
      ? `Intake partly complete${ws.intake.reason_incomplete ? ` (${ws.intake.reason_incomplete})` : ""}`
      : ws.intake.state === "unsigned" || ws.intake.state === "none"
        ? "Intake not signed — recommendations update as findings are added"
        : "";

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="font-display text-[22px] font-semibold text-ink-900">Care plan</h2>
          <p className="mt-1 flex flex-wrap items-center gap-2 text-[13px] text-ink-500">
            {ws.version ? (
              <>
                <span className="rounded-full bg-brand-green-tint px-2 py-0.5 text-[11.5px] font-semibold text-brand-green">
                  Signed · v{ws.version}
                </span>
                <span>
                  {ws.confirmed_at ? formatDateTime(ws.confirmed_at) : ""} by {ws.confirmed_by}
                </span>
              </>
            ) : (
              <span className="rounded-full bg-surface-bg px-2 py-0.5 text-[11.5px] font-semibold text-ink-700">
                Draft
              </span>
            )}
          </p>
        </div>
        <div className="flex flex-col items-end gap-1">
          <button type="button" className={BTN} disabled={signing || !ready} onClick={startSigning}>
            {signing ? "Signing…" : ws.version ? "Sign new version" : "Sign care plan"}
          </button>
          {!ready && (
            <span className="text-[11.5px] text-ink-500">
              {ws.outstanding.length} item{ws.outstanding.length === 1 ? "" : "s"} before signing
            </span>
          )}
        </div>
      </header>

      {(intakeNote || ws.rules_approval === "illustrative") && (
        <p className="-mt-3 text-[12px] text-ink-500">
          {[
            intakeNote,
            ws.rules_approval === "illustrative" &&
              "Recommendations are suggestions; trigger rules await clinical approval",
          ]
            .filter(Boolean)
            .join(" · ")}
          .
        </p>
      )}

      <ErrorNote>{error}</ErrorNote>

      {reviewing && (
        <section
          role="alertdialog"
          aria-labelledby="bulk-review-title"
          className="rounded-xl border border-priority-orange bg-priority-orange-tint p-4"
        >
          <h3 id="bulk-review-title" className="text-[14px] font-semibold text-ink-900">
            Review the actions accepted in bulk
          </h3>
          <ul className="mt-2 flex flex-col gap-1 text-[13px] text-ink-900">
            {bulk.map((a) => (
              <li key={a.id}>
                <span className="font-medium">{a.name}</span>
                <span className="text-ink-700"> — {a.why[0] ?? "recommended from the record"}</span>
              </li>
            ))}
          </ul>
          <label className="mt-3 flex items-center gap-2 text-[13px] font-medium">
            <input
              type="checkbox"
              checked={bulkReviewed}
              onChange={(e) => setBulkReviewed(e.target.checked)}
            />
            I have reviewed each of these actions
          </label>
          <div className="mt-3 flex gap-2">
            <button
              type="button"
              className={BTN}
              disabled={!bulkReviewed || signing}
              onClick={() => void sign()}
            >
              {signing ? "Signing…" : "Sign care plan"}
            </button>
            <button type="button" className={BTN_GHOST} onClick={() => setReviewing(false)}>
              Keep editing
            </button>
          </div>
        </section>
      )}

      {planCosign.map((c) => (
        <p
          key={c.id}
          role="status"
          className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-lg border border-surface-border px-3 py-2 text-[12.5px] text-ink-700"
        >
          <span
            aria-hidden="true"
            className={`h-2 w-2 rounded-full ${c.status === "DECLINED" ? "bg-priority-red" : c.status === "SIGNED" ? "bg-priority-green" : "bg-priority-orange"}`}
          />
          <span className="font-semibold text-ink-900">
            Senior co-signature{" "}
            {c.status === "REQUESTED"
              ? "requested"
              : c.status === "SIGNED"
                ? "given"
                : c.status.toLowerCase()}
          </span>
          <span>
            {c.what} · requested by {c.requested_by}
          </span>
          {c.decline_reason && <span>· “{c.decline_reason}”</span>}
          {c.thread.length > 0 && <span>· “{c.thread[c.thread.length - 1].note}”</span>}
        </p>
      ))}

      {ws.conflicts.length > 0 && <ConflictCard patientId={patientId} ws={ws} onChange={setWs} />}

      <DecisionsTab patientId={patientId} ws={ws} onChange={setWs} disabled={false} />

      {!ready && (
        <section
          aria-labelledby="before-signing"
          className="max-w-[880px] rounded-xl border border-surface-border bg-surface-bg px-4 py-3"
        >
          <h3
            id="before-signing"
            className="text-[11px] font-bold uppercase tracking-[.5px] text-ink-500"
          >
            Before you can sign
          </h3>
          <ul className="mt-2 flex flex-col gap-1 text-[13px] text-ink-900">
            {ws.outstanding.map((o) => (
              <li key={o} className="flex gap-2">
                <span aria-hidden="true" className="text-ink-300">
                  ○
                </span>
                {o}
              </li>
            ))}
          </ul>
        </section>
      )}

      <p className="border-t border-surface-border pt-4 text-[12.5px] text-ink-500">
        Accepted actions are delivered and tracked in{" "}
        <strong className="font-semibold">Interventions</strong> once the plan is signed. The safety
        plan is written there, under Observation &amp; safety.
      </p>
    </div>
  );
}

/** Shown only when the plan conflicts with the client's risk (care_plan.conflicts):
 * the signer explains why, and a senior co-signs. */
function ConflictCard({
  patientId,
  ws,
  onChange,
}: {
  patientId: string;
  ws: PlanWorkspace;
  onChange: (next: PlanWorkspace) => void;
}) {
  const { accessToken } = useAuth();
  const [seniors, setSeniors] = useState<{ id: string; name: string }[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!accessToken) return;
    let live = true;
    listSeniors(accessToken)
      .then((r) => live && setSeniors(r.results))
      .catch((e) => live && setError(errorText(e, "Couldn't load senior reviewers.")));
    return () => {
      live = false;
    };
  }, [accessToken]);

  async function save(patch: { rationale?: string; senior_reviewer?: string }) {
    if (!accessToken) return;
    setError(null);
    try {
      onChange(await updatePlanDetails(accessToken, patientId, patch));
    } catch (e) {
      setError(errorText(e, "Couldn't save."));
    }
  }

  return (
    <section
      aria-labelledby="plan-conflict-title"
      className="max-w-[880px] rounded-xl border border-priority-orange bg-surface-card p-4"
    >
      <h3 id="plan-conflict-title" className="text-[14px] font-semibold text-ink-900">
        This plan needs a rationale and a senior reviewer
      </h3>
      <ErrorNote>{error}</ErrorNote>
      <ul className="mb-3 mt-2 list-disc pl-5 text-[13px] text-ink-700">
        {ws.conflicts.map((c) => (
          <li key={c}>{c}</li>
        ))}
      </ul>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <label className="flex flex-col gap-1 sm:col-span-2">
          <span className={FIELD_LABEL}>
            Clinical rationale <span className="text-priority-red">*</span>
          </span>
          <AutoResizeTextarea
            rows={2}
            defaultValue={ws.details.rationale}
            onBlur={(e) =>
              e.target.value !== ws.details.rationale && void save({ rationale: e.target.value })
            }
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className={FIELD_LABEL}>
            Senior reviewer (co-signs) <span className="text-priority-red">*</span>
          </span>
          <select
            className={INPUT}
            value={ws.details.senior_reviewer}
            onChange={(e) => void save({ senior_reviewer: e.target.value })}
          >
            <option value="">— choose —</option>
            {seniors.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </label>
      </div>
    </section>
  );
}
