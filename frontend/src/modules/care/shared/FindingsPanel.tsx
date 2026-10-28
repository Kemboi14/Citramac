import { useEffect, useState, type ReactNode } from "react";
import { useAuth } from "../../../auth/useAuth";
import {
  getClientFindings,
  getFindingHistory,
  reviewFinding,
  type ClinicalFinding,
  type FindingStatus,
} from "../../../lib/findingsApi";
import { errorText } from "../triage/helpers";
import { formatDateTime } from "./format";
import { BTN, BTN_GHOST, BTN_SM, INPUT, TABLE, TD, TH } from "./styles";
import { Card, ErrorNote, SelectChoices, Tag } from "./ui";
import { useValueSets } from "./useValueSets";

const STATUS_TONE: Record<FindingStatus, "risk" | "neutral" | "warn"> = {
  PRESENT: "risk",
  ABSENT: "neutral",
  UNKNOWN: "warn",
};

function recorded(f: ClinicalFinding) {
  return `${formatDateTime(f.recorded_at)} · ${f.recorded_by || "—"} · ${f.stage.toLowerCase()}`;
}

/**
 * The client's current clinical findings (triage spec §16–§18): each with its
 * status, source, time and recorder. A later stage confirms a finding unchanged
 * or updates it — a new version; the earlier value stays in the history.
 * `reviewedElsewhere` maps a finding key to where this stage already confirms
 * it (e.g. the Intake risk register): shown, not offered for review twice.
 */
export function FindingsPanel({
  patientId,
  stage,
  readOnly,
  reviewedElsewhere,
}: {
  patientId: string;
  stage: string;
  readOnly?: boolean;
  reviewedElsewhere?: Map<string, string>;
}) {
  const { accessToken } = useAuth();
  const vs = useValueSets();
  const [rows, setRows] = useState<ClinicalFinding[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState<{ status: string; note: string }>({ status: "", note: "" });
  const [history, setHistory] = useState<Record<string, ClinicalFinding[]>>({});
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!accessToken) return;
    let cancelled = false;
    getClientFindings(accessToken, patientId)
      .then((r) => !cancelled && setRows(r.results))
      .catch((e) => !cancelled && setError(errorText(e, "Couldn't load the clinical findings.")));
    return () => {
      cancelled = true;
    };
  }, [accessToken, patientId]);

  if (rows === null || rows.length === 0) return error ? <ErrorNote>{error}</ErrorNote> : null;

  function replace(next: ClinicalFinding) {
    setRows((prev) => (prev ?? []).map((r) => (r.key === next.key ? next : r)));
    setHistory((prev) => {
      const copy = { ...prev };
      delete copy[next.key];
      return copy;
    });
  }

  async function submit(f: ClinicalFinding, action: "CONFIRMED" | "UPDATED") {
    if (!accessToken || busy) return;
    setBusy(true);
    setError(null);
    try {
      const next = await reviewFinding(accessToken, patientId, {
        key: f.key,
        action,
        stage,
        ...(action === "UPDATED"
          ? { status: (draft.status || f.status) as FindingStatus, note: draft.note.trim() }
          : {}),
      });
      replace(next);
      setEditing(null);
    } catch (e) {
      setError(errorText(e, "Not saved — check your connection and try again."));
    } finally {
      setBusy(false);
    }
  }

  async function toggleHistory(key: string) {
    if (history[key]) {
      setHistory((prev) => {
        const copy = { ...prev };
        delete copy[key];
        return copy;
      });
      return;
    }
    if (!accessToken) return;
    try {
      const r = await getFindingHistory(accessToken, patientId, key);
      setHistory((prev) => ({ ...prev, [key]: r.results }));
    } catch (e) {
      setError(errorText(e, "Couldn't load the history."));
    }
  }

  return (
    <Card title="Clinical findings already recorded" className="mb-4" bodyClassName="p-0">
      {error && (
        <div className="px-[18px] pt-3">
          <ErrorNote>{error}</ErrorNote>
        </div>
      )}
      <div className="overflow-x-auto">
        <table className={TABLE}>
          <thead>
            <tr>
              <th className={TH}>Finding</th>
              <th className={TH}>Status</th>
              <th className={TH}>Source</th>
              <th className={TH}>Recorded</th>
              {!readOnly && (
                <th className={TH}>
                  <span className="sr-only">Review</span>
                </th>
              )}
            </tr>
          </thead>
          <tbody>
            {rows.map((f) => {
              const elsewhere = reviewedElsewhere?.get(f.key);
              const reviewedHere = f.stage === stage;
              return (
                <FindingRow
                  key={f.key}
                  f={f}
                  readOnly={readOnly}
                  actions={
                    elsewhere ? (
                      <span className="text-[12px] text-ink-500">{elsewhere}</span>
                    ) : reviewedHere ? (
                      <Tag tone="brand">{f.action === "CONFIRMED" ? "Confirmed" : "Updated"}</Tag>
                    ) : (
                      <div className="flex flex-wrap gap-1.5">
                        <button
                          type="button"
                          className={`${BTN_GHOST} ${BTN_SM}`}
                          disabled={busy}
                          onClick={() => submit(f, "CONFIRMED")}
                        >
                          Confirm unchanged
                        </button>
                        <button
                          type="button"
                          className={`${BTN_GHOST} ${BTN_SM}`}
                          aria-expanded={editing === f.key}
                          onClick={() => {
                            setEditing(editing === f.key ? null : f.key);
                            setDraft({ status: f.status, note: "" });
                          }}
                        >
                          Update / add
                        </button>
                      </div>
                    )
                  }
                  editor={
                    editing === f.key && (
                      <div className="flex flex-wrap items-end gap-2">
                        <label className="text-[12px]">
                          Status now
                          <SelectChoices
                            options={vs.options("clinical-finding-status")}
                            value={draft.status}
                            onChange={(status) => setDraft((d) => ({ ...d, status }))}
                          />
                        </label>
                        <label className="min-w-[240px] flex-1 text-[12px]">
                          What changed / new information
                          <textarea
                            rows={2}
                            className={`${INPUT} resize-y`}
                            value={draft.note}
                            onChange={(e) => {
                              const note = e.target.value;
                              setDraft((d) => ({ ...d, note }));
                            }}
                          />
                        </label>
                        <button
                          type="button"
                          className={`${BTN} ${BTN_SM}`}
                          disabled={busy}
                          onClick={() => submit(f, "UPDATED")}
                        >
                          Save update
                        </button>
                      </div>
                    )
                  }
                  history={history[f.key]}
                  onHistory={() => toggleHistory(f.key)}
                />
              );
            })}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

function FindingRow({
  f,
  readOnly,
  actions,
  editor,
  history,
  onHistory,
}: {
  f: ClinicalFinding;
  readOnly?: boolean;
  actions: ReactNode;
  editor: ReactNode;
  history?: ClinicalFinding[];
  onHistory: () => void;
}) {
  const span = readOnly ? 4 : 5;
  return (
    <>
      <tr>
        <td className={TD}>
          <strong>{f.title}</strong>
          {f.summary && <div className="text-[12px] text-ink-500">{f.summary}</div>}
          {f.note && <div className="text-[12px] text-ink-700">Note: {f.note}</div>}
        </td>
        <td className={TD}>
          <Tag tone={STATUS_TONE[f.status]}>{f.status_label}</Tag>
        </td>
        <td className={TD}>
          {f.source_label}
          {f.source_detail && <div className="text-[12px] text-ink-500">{f.source_detail}</div>}
        </td>
        <td className={TD}>
          {recorded(f)}
          {f.version > 1 && (
            <button
              type="button"
              className="block text-[12px] text-brand-green underline"
              aria-expanded={Boolean(history)}
              onClick={onHistory}
            >
              {history ? "Hide history" : `History (${f.version} versions)`}
            </button>
          )}
        </td>
        {!readOnly && <td className={TD}>{actions}</td>}
      </tr>
      {editor && (
        <tr>
          <td colSpan={span} className={`${TD} bg-surface-bg`}>
            {editor}
          </td>
        </tr>
      )}
      {history && (
        <tr>
          <td colSpan={span} className={`${TD} bg-surface-bg`}>
            <ul className="space-y-1 text-[12px]">
              {history.map((h) => (
                <li key={h.id}>
                  v{h.version} · {h.status_label} · {h.action.toLowerCase()} · {h.source_label} ·{" "}
                  {recorded(h)}
                  {h.note && ` — ${h.note}`}
                </li>
              ))}
            </ul>
          </td>
        </tr>
      )}
    </>
  );
}
