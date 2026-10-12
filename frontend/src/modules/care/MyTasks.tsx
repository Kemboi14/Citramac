import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../../auth/useAuth";
import { getMyTasks, type MyTask } from "../../lib/carePathwayApi";
import { formatDateTime } from "./shared/format";
import { clientRecordPath } from "./shared/recordRoutes";
import { Card, ErrorNote, Tag } from "./shared/ui";
import { errorText } from "./triage/helpers";

/** Everything outstanding across the clients in care, overdue first — computed
 * from the record, so it cannot drift from it. */
export function MyTasks() {
  const { accessToken } = useAuth();
  const [tasks, setTasks] = useState<MyTask[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!accessToken) return;
    getMyTasks(accessToken).then((r) => setTasks(r.results)).catch((e) => setError(errorText(e, "Couldn't load tasks.")));
  }, [accessToken]);
  return (
    <Card title={<>My tasks {tasks && <Tag>{tasks.length}</Tag>}</>}>
      <ErrorNote>{error}</ErrorNote>
      {!tasks ? (
        <p className="text-[13px] text-ink-500">Loading…</p>
      ) : tasks.length === 0 ? (
        <p className="text-[13px] text-ink-500">Nothing outstanding.</p>
      ) : (
        <ul className="flex max-h-96 flex-col gap-1.5 overflow-auto text-[13px]">
          {tasks.slice(0, 100).map((t) => (
            <li key={`${t.patient_id}:${t.key}`} className="flex flex-wrap items-center gap-2">
              <Tag tone={t.overdue ? "risk" : "neutral"}>{t.category}</Tag>
              <Link to={clientRecordPath(t.patient_id, "snapshot")} className="font-semibold text-brand-green hover:underline">{t.patient}</Link>
              {t.text}
              {t.due_at && <span className="text-ink-500">{t.overdue ? "overdue since" : "due"} {formatDateTime(t.due_at)}</span>}
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
