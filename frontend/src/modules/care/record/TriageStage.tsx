import { useEffect, useState } from "react";
import { CheckCircle2, Clock, Plus, X } from "lucide-react";
import { Link } from "react-router-dom";
import { useAuth } from "../../../auth/useAuth";
import {
  listClientTriages,
  startNewTriage,
  type ClientTriageRow,
} from "../../../lib/carePathwayApi";
import { TriageEncounterScreen } from "../TriageEncounterPage";
import { formatDateTime } from "../shared/format";
import { BTN, BTN_GHOST, BTN_SM } from "../shared/styles";
import { Card, ErrorNote, PageHeader, PriorityPill } from "../shared/ui";
import type { RecordViewProps } from "./types";

/**
 * The client record's Triage tab. One triage opens straight on the triage
 * screen the dashboard and triage queue use (/clinical/triage/:id). A client
 * with several arrivals sees their triages listed, newest first, and opens one.
 */
export function TriageStage({ patientId, banner, onRecordChanged }: RecordViewProps) {
  const { accessToken } = useAuth();
  const latest = banner.latest_triage_encounter_id ?? banner.latest_signed_triage_encounter_id;
  const [rows, setRows] = useState<ClientTriageRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [version, setVersion] = useState(0);
  const [starting, setStarting] = useState(false);
  const [requestId] = useState(() => crypto.randomUUID());

  useEffect(() => {
    if (!accessToken || !latest) return;
    let cancelled = false;
    listClientTriages(accessToken, patientId)
      .then((data) => {
        if (!cancelled) {
          setRows(data.results);
          setError(null);
        }
      })
      .catch(() => {
        // The latest triage still opens; only the list is missing.
        if (!cancelled) setError("Couldn't load the client's other triages.");
      });
    return () => {
      cancelled = true;
    };
  }, [accessToken, patientId, latest, version]);

  if (!latest) {
    return (
      <div className="animate-fade-in">
        <PageHeader title="Triage" subtitle="Complete the client's triage before intake" />
        <Card title="No triage encounter">
          <p className="text-[13px] text-ink-700">
            No triage encounter has been recorded for this client. Start the registration and
            arrival process to create one before capturing triage.
          </p>
          <Link to="/clinical/registration" className={`${BTN_GHOST} mt-4 inline-flex`}>
            Go to registration
          </Link>
        </Card>
      </div>
    );
  }

  const changed = () => {
    setVersion((v) => v + 1);
    onRecordChanged?.();
  };
  const newTriage = async () => {
    if (!accessToken) return;
    setStarting(true);
    setError(null);
    try {
      const { id } = await startNewTriage(accessToken, patientId, requestId);
      setVersion((v) => v + 1);
      setOpenId(id);
      onRecordChanged?.();
    } catch {
      setError("Couldn't start a new triage. Try again.");
    } finally {
      setStarting(false);
    }
  };

  if (openId) {
    return (
      <div className="flex flex-col gap-3">
        <div className="flex items-center justify-between gap-2">
          <button
            type="button"
            className={`${BTN_GHOST} ${BTN_SM}`}
            onClick={() => setOpenId(null)}
          >
            ← All triages
          </button>
          <button
            type="button"
            className={`${BTN_GHOST} ${BTN_SM}`}
            aria-label="Close triage"
            onClick={() => setOpenId(null)}
          >
            <X aria-hidden className="h-4 w-4" />
            Close
          </button>
        </div>
        {/* A block wrapper: inside this flex column the screen's own centring
            (mx-auto) would otherwise shrink it to its content. */}
        <div className="w-full">
          <TriageEncounterScreen
            key={openId}
            triageId={openId}
            onChanged={changed}
            inClientRecord
          />
        </div>
      </div>
    );
  }

  return (
    <div className="animate-fade-in">
      <PageHeader
        title="Triage"
        subtitle="Every arrival's triage, newest first"
        actions={
          <button
            type="button"
            className={`${BTN} ${BTN_SM}`}
            disabled={starting}
            onClick={() => void newTriage()}
          >
            <Plus aria-hidden className="h-4 w-4" />
            {starting ? "Starting…" : "New triage"}
          </button>
        }
      />
      <ErrorNote>{error}</ErrorNote>
      <ol className="flex flex-col gap-3">
        {rows === null && !error && <li className="text-[13px] text-ink-500">Loading triages…</li>}
        {(rows ?? []).map((row) => (
          <li
            key={row.id}
            className="flex flex-wrap items-center gap-3 rounded-xl border border-surface-border bg-surface-card p-4 shadow-sm"
          >
            {row.in_progress ? (
              <Clock aria-hidden className="h-6 w-6 shrink-0 text-amber-600" />
            ) : (
              <CheckCircle2 aria-hidden className="h-6 w-6 shrink-0 text-[var(--green)]" />
            )}
            <div className="mr-auto min-w-0">
              <p className="flex flex-wrap items-center gap-2 text-[15px] font-semibold text-ink-900">
                {row.in_progress ? "Triage in progress" : "Triage completed"}
                {row.priority && <PriorityPill priority={row.priority} long />}
              </p>
              <p className="text-[12.5px] text-ink-500">
                {row.signed_at
                  ? `Signed ${formatDateTime(row.signed_at)} by ${row.signed_by}`
                  : `Arrived ${formatDateTime(row.arrival_at)}`}
                {row.versions > 1 ? ` · version ${row.versions} of ${row.versions}` : ""}
                {row.rechecks > 0
                  ? ` · ${row.rechecks} re-check${row.rechecks === 1 ? "" : "s"}`
                  : ""}
              </p>
              {row.presenting_concern && (
                <p
                  className="mt-0.5 line-clamp-1 text-[13px] text-ink-700"
                  title={row.presenting_concern}
                >
                  {row.presenting_concern}
                </p>
              )}
            </div>
            <button
              type="button"
              className={`${row.in_progress ? BTN : BTN_GHOST} ${BTN_SM}`}
              onClick={() => setOpenId(row.id)}
            >
              {row.in_progress ? "Continue" : "Open"}
            </button>
          </li>
        ))}
      </ol>
    </div>
  );
}
