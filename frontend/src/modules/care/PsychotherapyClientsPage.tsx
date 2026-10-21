import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../../auth/useAuth";
import { listPsyClients, type PsyClientRow } from "../../lib/psychotherapyNoteApi";
import { PsychotherapySessionNote } from "./record/modules/PsychotherapySessionNote";
import { clientRecordPath } from "./shared/recordRoutes";
import { formatDate, formatDateTime } from "./shared/format";
import { BTN, BTN_GHOST, BTN_SM, TABLE, TD, TH } from "./shared/styles";
import { Card, ErrorNote, PageHeader } from "./shared/ui";
import { errorText } from "./triage/helpers";

// Individual Psychotherapy — the client's mockup `individualPsychotherapyPage()`:
// clients with an open therapy episode or a psychotherapy action on their care
// plan (server: care_pathway/psychotherapy.py client_list). Session counts and
// dates are psychotherapy content, so the server sends them only for clients
// the user has full MHP access to; the list view is audit-logged there.

export function PsychotherapyClientsPage() {
  const { accessToken } = useAuth();
  const navigate = useNavigate();
  const [rows, setRows] = useState<PsyClientRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [session, setSession] = useState<{ patientId: string; episodeId: string } | null>(null);

  const load = useCallback(() => {
    if (!accessToken) return;
    listPsyClients(accessToken)
      .then((res) => setRows(res.results))
      .catch((e) => setError(errorText(e, "Couldn't load the psychotherapy clients.")));
  }, [accessToken]);
  useEffect(load, [load]);

  const openRecord = (row: PsyClientRow) => navigate(clientRecordPath(row.patient_id, "interventions"));

  return (
    <div className="flex animate-fade-in flex-col gap-5">
      <PageHeader title="Individual Psychotherapy" subtitle="Clients listed for psychotherapy in Interventions and their recorded sessions" />
      <ErrorNote>{error}</ErrorNote>
      <Card title={`Psychotherapy clients (${rows?.length ?? 0})`} bodyClassName="p-0">
        <div className="overflow-x-auto">
          <table className={`${TABLE} min-w-[760px]`}>
            <thead>
              <tr>
                <th className={TH}>Client</th>
                <th className={TH}>Diagnosis</th>
                <th className={TH}>Sessions recorded</th>
                <th className={TH}>Last session</th>
                <th className={TH}>Next appointment</th>
                <th className={TH}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {!rows && !error && (
                <tr><td colSpan={6} className={`${TD} text-center text-ink-500`}>Loading…</td></tr>
              )}
              {rows && rows.length === 0 && (
                <tr><td colSpan={6} className={`${TD} py-6 text-center text-ink-500`}>No clients are currently listed for individual psychotherapy.</td></tr>
              )}
              {rows?.map((row) => (
                <tr key={row.patient_id} className="hover:bg-surface-bg">
                  <td className={TD}>
                    <strong>{row.name}</strong>
                    <br />
                    <span className="font-mono text-[11px] text-ink-500">{row.number || "—"}</span>
                  </td>
                  <td className={TD}>{row.diagnosis || "Not assessed"}</td>
                  <td className={TD}>
                    {row.restricted ? <span className="text-[12px] text-ink-500">Care team only</span> : row.sessions_recorded ?? 0}
                  </td>
                  <td className={`${TD} whitespace-nowrap`}>{row.restricted ? "—" : row.last_session ? formatDate(row.last_session) : "—"}</td>
                  <td className={`${TD} whitespace-nowrap`}>{row.next_appointment ? formatDateTime(row.next_appointment) : "—"}</td>
                  <td className={TD}>
                    <div className="flex flex-wrap gap-1.5">
                      <button type="button" className={`${BTN_GHOST} ${BTN_SM}`} onClick={() => openRecord(row)}>Open client record</button>
                      {row.episode_id ? (
                        <button type="button" className={`${BTN} ${BTN_SM}`}
                          onClick={() => setSession({ patientId: row.patient_id, episodeId: row.episode_id as string })}>Start session</button>
                      ) : (
                        <button type="button" className={`${BTN} ${BTN_SM}`} onClick={() => openRecord(row)}
                          title="No therapy episode with agreed confidentiality limits yet — set it up on the client record (Interventions › Therapy).">
                          Start session
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
      {rows?.some((r) => !r.episode_id) && (
        <p className="text-[12px] text-ink-500">“Start session” opens the client record for clients without a therapy episode whose confidentiality limits have been agreed — start the episode there first.</p>
      )}
      {session && (
        <PsychotherapySessionNote patientId={session.patientId} episodeId={session.episodeId}
          onClose={() => { setSession(null); load(); }} />
      )}
    </div>
  );
}
