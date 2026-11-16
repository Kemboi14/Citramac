import { useCallback, useEffect, useState } from "react";
import { useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { useAuth } from "../../auth/useAuth";
import {
  listPsyClients,
  listPsySessions,
  type PsyClientRow,
  type PsySessionRow,
} from "../../lib/psychotherapyNoteApi";
import {
  clientRecordPath,
  psychotherapyListPath,
  psychotherapyNotePath,
  psychotherapySessionPath,
  type PsychotherapyKind,
} from "./shared/recordRoutes";
import { formatDate, formatDateTime } from "./shared/format";
import { BTN, BTN_GHOST, BTN_SM, TABLE, TD, TH } from "./shared/styles";
import { Card, ErrorNote, PageHeader } from "./shared/ui";
import { errorText } from "./triage/helpers";

// Individual Psychotherapy — the client's mockup `individualPsychotherapyPage()`:
// clients with an open therapy episode or a psychotherapy action on their care
// plan (server: care_pathway/psychotherapy.py client_list). Session counts and
// dates are psychotherapy content, so the server sends them only for clients
// the user has full MHP access to; the list view is audit-logged there.

export function PsychotherapyClientsPage({ kind = "individual" }: { kind?: PsychotherapyKind }) {
  const { accessToken } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams, setSearchParams] = useSearchParams();
  const [rows, setRows] = useState<PsyClientRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sessions, setSessions] = useState<PsySessionRow[] | null>(null);
  const [sessionsError, setSessionsError] = useState<string | null>(null);
  const activeTab = searchParams.get("tab") === "sessions" ? "sessions" : "clients";

  const title = kind === "family" ? "Family Psychotherapy" : "Individual Psychotherapy";
  const subtitle =
    kind === "family"
      ? "Clients listed for family therapy in Interventions and their recorded sessions"
      : "Clients listed for psychotherapy in Interventions and their recorded sessions";

  const load = useCallback(() => {
    if (!accessToken) return;
    listPsyClients(accessToken, kind)
      .then((res) => setRows(res.results))
      .catch((e) => setError(errorText(e, "Couldn't load the psychotherapy clients.")));
  }, [accessToken, kind]);
  useEffect(load, [load]);

  useEffect(() => {
    if (!accessToken || activeTab !== "sessions") return;
    let active = true;
    listPsySessions(accessToken, kind)
      .then((res) => {
        if (active) setSessions(res.results);
      })
      .catch((e) => {
        if (active)
          setSessionsError(errorText(e, `Couldn't load the ${kind} psychotherapy sessions.`));
      });
    return () => {
      active = false;
    };
  }, [accessToken, activeTab, kind]);

  const selectTab = (tab: "clients" | "sessions") => {
    if (tab === "sessions") {
      setSessions(null);
      setSessionsError(null);
    }
    const next = new URLSearchParams(searchParams);
    if (tab === "sessions") next.set("tab", tab);
    else next.delete("tab");
    setSearchParams(next);
  };

  const openRecord = (row: PsyClientRow) =>
    navigate(clientRecordPath(row.patient_id, "interventions"));
  const openSession = (session: PsySessionRow) =>
    navigate(psychotherapyNotePath(kind, session.patient_id, session.therapy_episode, session.id), {
      state: { from: psychotherapyListPath(kind, "sessions") },
    });
  // With an agreed episode the session page prepares the session; without one
  // it sets up the episode first. Either way the session is written there.
  const startSession = (row: PsyClientRow) =>
    navigate(psychotherapySessionPath(kind, row.patient_id, row.episode_id ?? undefined), {
      state: { from: location.pathname },
    });

  return (
    <div className="flex animate-fade-in flex-col gap-5">
      <PageHeader title={title} subtitle={subtitle} />
      <div role="tablist" aria-label={title} className="flex gap-2">
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === "clients"}
          className={activeTab === "clients" ? BTN : BTN_GHOST}
          onClick={() => selectTab("clients")}
        >
          Clients
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === "sessions"}
          className={activeTab === "sessions" ? BTN : BTN_GHOST}
          onClick={() => selectTab("sessions")}
        >
          Sessions
        </button>
      </div>
      {activeTab === "sessions" ? (
        <>
          <ErrorNote>{sessionsError}</ErrorNote>
          <Card
            title={`${kind === "family" ? "Family" : "Individual"} psychotherapy sessions (${sessions?.length ?? 0})`}
            bodyClassName="p-0"
          >
            <div className="overflow-x-auto">
              <table className={`${TABLE} min-w-[700px]`}>
                <thead>
                  <tr>
                    <th className={TH}>Client</th>
                    <th className={TH}>Session date</th>
                    <th className={TH}>Status</th>
                    <th className={TH}>Clinician</th>
                    <th className={TH}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {!sessions && !sessionsError && (
                    <tr>
                      <td colSpan={5} className={`${TD} text-center text-ink-500`}>
                        Loading sessions…
                      </td>
                    </tr>
                  )}
                  {sessions && sessions.length === 0 && (
                    <tr>
                      <td colSpan={5} className={`${TD} py-6 text-center text-ink-500`}>
                        No {kind} psychotherapy sessions are available to view.
                      </td>
                    </tr>
                  )}
                  {sessions?.map((session) => (
                    <tr key={session.id} className="hover:bg-surface-bg">
                      <td className={TD}>
                        <strong>{session.patient_name}</strong>
                        <br />
                        <span className="font-mono text-[11px] text-ink-500">
                          {session.patient_number || "—"}
                        </span>
                      </td>
                      <td className={`${TD} whitespace-nowrap`}>
                        {formatDateTime(session.session_date)}
                      </td>
                      <td className={TD}>{session.status === "SIGNED" ? "Signed" : "Draft"}</td>
                      <td className={TD}>{session.author}</td>
                      <td className={TD}>
                        <button
                          type="button"
                          className={`${BTN_GHOST} ${BTN_SM}`}
                          onClick={() => openSession(session)}
                        >
                          Open session
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        </>
      ) : (
        <>
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
                    <tr>
                      <td colSpan={6} className={`${TD} text-center text-ink-500`}>
                        Loading…
                      </td>
                    </tr>
                  )}
                  {rows && rows.length === 0 && (
                    <tr>
                      <td colSpan={6} className={`${TD} py-6 text-center text-ink-500`}>
                        No clients are currently listed for {kind} psychotherapy.
                      </td>
                    </tr>
                  )}
                  {rows?.map((row) => (
                    <tr key={row.patient_id} className="hover:bg-surface-bg">
                      <td className={TD}>
                        <strong>{row.name}</strong>
                        <br />
                        <span className="font-mono text-[11px] text-ink-500">
                          {row.number || "—"}
                        </span>
                      </td>
                      <td className={TD}>{row.diagnosis || "Not assessed"}</td>
                      <td className={TD}>
                        {row.restricted ? (
                          <span className="text-[12px] text-ink-500">Care team only</span>
                        ) : (
                          (row.sessions_recorded ?? 0)
                        )}
                      </td>
                      <td className={`${TD} whitespace-nowrap`}>
                        {row.restricted
                          ? "—"
                          : row.last_session
                            ? formatDate(row.last_session)
                            : "—"}
                      </td>
                      <td className={`${TD} whitespace-nowrap`}>
                        {row.next_appointment ? formatDateTime(row.next_appointment) : "—"}
                      </td>
                      <td className={TD}>
                        <div className="flex flex-wrap gap-1.5">
                          <button
                            type="button"
                            className={`${BTN_GHOST} ${BTN_SM}`}
                            onClick={() => openRecord(row)}
                          >
                            Open client record
                          </button>
                          <button
                            type="button"
                            className={`${BTN} ${BTN_SM}`}
                            onClick={() => startSession(row)}
                          >
                            {row.episode_id ? "Start session" : "Set up therapy"}
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
          {rows?.some((r) => !r.episode_id) && (
            <p className="text-[12px] text-ink-500">
              “Set up therapy” starts the client’s therapy episode and agrees the limits of
              confidentiality before the first session.
            </p>
          )}
        </>
      )}
    </div>
  );
}
