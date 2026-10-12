import { useCallback, useEffect, useState } from "react";
import { useAuth } from "../../../../auth/useAuth";
import {
  decideTool,
  getClientTools,
  getInstruments,
  type InstrumentDef,
  type ToolRow,
} from "../../../../lib/carePathwayApi";
import { errorText } from "../../triage/helpers";
import { BTN, BTN_GHOST, BTN_SM, INPUT } from "../../shared/styles";
import { Callout, ErrorNote, Tag } from "../../shared/ui";
import { AssessmentForm } from "./AssessmentForm";

const TONE: Record<ToolRow["status"], "neutral" | "warn" | "brand" | "risk"> = {
  Recommended: "warn",
  "In progress": "brand",
  Completed: "brand",
  Declined: "neutral",
  "Not indicated": "neutral",
};

/** Section 20 — findings recommend a tool; the clinician accepts, starts it
 * anyway, or declines with a reason. Scores are stored once and flow to the
 * Care Plan and Outcomes. */
export function ToolsSection({
  patientId,
  onChanged,
}: {
  patientId: string;
  onChanged: () => void;
}) {
  const { accessToken } = useAuth();
  const [tools, setTools] = useState<ToolRow[] | null>(null);
  const [defs, setDefs] = useState<InstrumentDef[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [declining, setDeclining] = useState<string | null>(null);
  const [reason, setReason] = useState("");

  const load = useCallback(async () => {
    if (!accessToken) return;
    try {
      const [t, d] = await Promise.all([getClientTools(accessToken, patientId), getInstruments(accessToken)]);
      setTools(t.results);
      setDefs(d.results);
    } catch (e) {
      setError(errorText(e, "Couldn't load the assessment tools."));
    }
  }, [accessToken, patientId]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- fetch on mount.
    void load();
  }, [load]);

  async function decide(key: string, status: "ACCEPTED" | "DECLINED" | "RECONSIDERED", why = "") {
    if (!accessToken) return;
    setError(null);
    try {
      const result = await decideTool(accessToken, patientId, key, status, why);
      setTools(result.results);
      setDeclining(null);
      setReason("");
      if (status === "ACCEPTED") setOpen(key);
      onChanged();
    } catch (e) {
      setError(errorText(e, "Couldn't save the decision."));
    }
  }

  if (!tools) return error ? <ErrorNote>{error}</ErrorNote> : <p className="text-[13px] text-ink-500">Loading…</p>;
  return (
    <div className="flex flex-col gap-3">
      <Callout>
        <strong>Findings recommend the tool — you confirm, start it anyway, or decline.</strong> No
        searching an assessment library. Scores are stored once and flow into the Care Plan and
        Outcomes.
      </Callout>
      <ErrorNote>{error}</ErrorNote>
      {tools.map((tool) => {
        const def = defs.find((d) => d.code === tool.key);
        return (
          <div key={tool.key} className="rounded-lg border border-surface-border p-3" data-status={tool.status}>
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-[13px] font-semibold text-ink-900">{tool.name}</span>
              <Tag tone={TONE[tool.status]}>{tool.status}</Tag>
              {tool.last && (
                <Tag>
                  {tool.last.score} · {tool.last.band}
                </Tag>
              )}
            </div>
            {tool.why.length > 0 && (
              <p className="mt-1 text-[12px] text-ink-500">
                <strong>Reason triggered:</strong> {tool.why.join(" · ")}
              </p>
            )}
            {tool.decision?.status === "DECLINED" && (
              <p className="mt-1 text-[12px] text-ink-500">
                Declined by {tool.decision.by} — “{tool.decision.reason}”
              </p>
            )}
            <div className="mt-2 flex flex-wrap gap-2">
              {["Recommended", "Not indicated"].includes(tool.status) && def && (
                <button type="button" className={`${tool.status === "Recommended" ? BTN : BTN_GHOST} ${BTN_SM}`} onClick={() => void decide(tool.key, "ACCEPTED")}>
                  {tool.status === "Recommended" ? "Accept & open" : "Start anyway"}
                </button>
              )}
              {tool.status === "Recommended" && (
                <button type="button" className={`${BTN_GHOST} ${BTN_SM}`} onClick={() => setDeclining(tool.key)}>
                  Decline…
                </button>
              )}
              {tool.status === "Declined" && (
                <button type="button" className={`${BTN_GHOST} ${BTN_SM}`} onClick={() => void decide(tool.key, "RECONSIDERED")}>
                  Reconsider
                </button>
              )}
              {["In progress", "Completed"].includes(tool.status) && def && (
                <button type="button" className={`${BTN_GHOST} ${BTN_SM}`} onClick={() => setOpen(open === tool.key ? null : tool.key)}>
                  {open === tool.key ? "Close form" : tool.last ? "Record repeat" : "Record score"}
                </button>
              )}
              {tool.kind === "link" && (
                <span className="text-[12px] text-ink-500">
                  {tool.key === "SAFETY" ? "Completed in the Care Plan." : "Completed in Section 3 (risk)."}
                </span>
              )}
            </div>
            {declining === tool.key && (
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <input className={`${INPUT} max-w-md`} aria-label="Reason for declining" placeholder="Reason for declining (required — clinical judgement)" value={reason} onChange={(e) => setReason(e.target.value)} />
                <button type="button" className={`${BTN} ${BTN_SM}`} disabled={reason.trim().length < 5} onClick={() => void decide(tool.key, "DECLINED", reason)}>
                  Confirm decline
                </button>
              </div>
            )}
            {open === tool.key && def && (
              <AssessmentForm
                patientId={patientId}
                def={def}
                context="intake"
                onCancel={() => setOpen(null)}
                onSaved={() => {
                  setOpen(null);
                  void load();
                  onChanged();
                }}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}
