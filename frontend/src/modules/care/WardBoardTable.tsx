import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../../auth/useAuth";
import { getWardBoardTable, type WardBoardRow } from "../../lib/carePathwayApi";
import { clientRecordPath } from "./shared/recordRoutes";
import { TABLE, TD, TH } from "./shared/styles";
import { Card, ErrorNote, Tag } from "./shared/ui";
import { errorText } from "./triage/helpers";

/** Handover table: legal status, observation level, early-warning trend and withdrawal
 * scores for every current inpatient, computed from the record. */
export function WardBoardTable() {
  const { accessToken } = useAuth();
  const [rows, setRows] = useState<WardBoardRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!accessToken) return;
    getWardBoardTable(accessToken).then((r) => setRows(r.results)).catch((e) => setError(errorText(e, "Couldn't load the handover table.")));
  }, [accessToken]);
  return (
    <Card title="Inpatient handover">
      <ErrorNote>{error}</ErrorNote>
      {rows && rows.length === 0 ? (
        <p className="text-[13px] text-ink-500">No current inpatients.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className={`${TABLE} min-w-[860px]`} aria-label="Inpatient handover">
            <thead>
              <tr>
                {["Client", "Bed", "Day", "Legal status", "Observation", "Early warning", "Withdrawal", "Next MDT", "Due ≤ 1 h"].map((h) => (
                  <th key={h} className={TH}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {(rows ?? []).map((r) => (
                <tr key={r.patient_id}>
                  <td className={TD}><Link className="font-semibold text-brand-green hover:underline" to={clientRecordPath(r.patient_id, "snapshot")}>{r.patient}</Link></td>
                  <td className={TD}>{r.ward} {r.bed}</td>
                  <td className={TD}>{r.day}</td>
                  <td className={TD}>{r.legal_status}</td>
                  <td className={TD}>{r.observation || "—"}</td>
                  <td className={TD}>{r.ews || "—"} {r.ews_trend && <Tag tone={r.ews_trend === "rising" ? "risk" : "neutral"}>{r.ews_trend}</Tag>}</td>
                  <td className={TD}>{Object.entries(r.withdrawal).map(([k, v]) => `${k} ${v.score} (${v.band})`).join(", ") || "—"}</td>
                  <td className={TD}>{r.next_mdt ?? "—"}</td>
                  <td className={TD}>{r.due_within_hour > 0 ? <Tag tone="warn">{r.due_within_hour}</Tag> : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}
