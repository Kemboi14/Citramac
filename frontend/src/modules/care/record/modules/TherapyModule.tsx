import { useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  agreeConfidentiality,
  getTherapy,
  startTherapy,
  type TherapyEpisodeRow,
  type TherapyState,
} from "../../../../lib/carePathwayApi";
import { formatDate } from "../../shared/format";
import {
  clientRecordPath,
  psychotherapyNotePath,
  psychotherapySessionPath,
  type PsychotherapyKind,
} from "../../shared/recordRoutes";
import { BTN, BTN_GHOST, BTN_SM, FIELD_LABEL, INPUT, TABLE, TD, TH } from "../../shared/styles";
import { Callout, ErrorNote, Tag } from "../../shared/ui";
import { useValueSets } from "../../shared/useValueSets";
import { Row } from "./ClinicalExtras";
import { useModule } from "./useModule";

const PHASES: [number, string][] = [
  [1, "1 — Safety & stabilisation"],
  [2, "2 — Processing"],
  [3, "3 — Integration"],
];
const START = {
  modality: "",
  planned: "",
  frequency: "",
  phase: "",
  consent: false,
  supervision: false,
  activity: "",
};

/** Therapy contract and numbered session notes. Measurement-based care scores go
 * to the shared outcome store through the instruments form; process notes are
 * offered only to roles that may see restricted content.
 *
 * Every session is written on the routed session page (client banner in view):
 * `kinds` are the session types offered here — both from Interventions, one from
 * the Individual or Family Psychotherapy menu — and `returnTo` is where that
 * page's Back goes. */
export function TherapyModule({
  patientId,
  kinds = ["individual", "family"],
  returnTo,
}: {
  patientId: string;
  kinds?: PsychotherapyKind[];
  returnTo?: string;
}) {
  const from = returnTo ?? clientRecordPath(patientId, "interventions");
  const vs = useValueSets();
  const { data, error, act } = useModule<TherapyState>(patientId, getTherapy);
  const [start, setStart] = useState(START);
  const open = (data?.results ?? []).filter((e) => !e.ended);
  const links = data?.link_options ?? [];
  const set = (p: Partial<typeof START>) => setStart((s) => ({ ...s, ...p }));
  return (
    <div className="flex flex-col gap-3">
      <ErrorNote>{error}</ErrorNote>
      {data &&
        open.map((e) => (
          <TherapyEpisode
            key={e.id}
            patientId={patientId}
            episode={e}
            state={data}
            act={act}
            kinds={kinds}
            from={from}
          />
        ))}
      <div className="rounded-lg border border-surface-border p-3">
        <div className={FIELD_LABEL}>Start a therapy episode</div>
        <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-3">
          <select
            className={INPUT}
            aria-label="Therapy modality"
            value={start.modality}
            onChange={(e) => set({ modality: e.target.value })}
          >
            <option value="">— modality —</option>
            {vs.options("therapy-modality").map((o) => (
              <option key={o.code} value={o.code}>
                {o.display}
              </option>
            ))}
          </select>
          <input
            className={INPUT}
            type="number"
            min={1}
            aria-label="Sessions planned"
            placeholder="Sessions planned"
            value={start.planned}
            onChange={(e) => set({ planned: e.target.value })}
          />
          <input
            className={INPUT}
            aria-label="Frequency"
            placeholder="Frequency (e.g. weekly)"
            value={start.frequency}
            onChange={(e) => set({ frequency: e.target.value })}
          />
          <select
            className={INPUT}
            aria-label="Trauma-therapy phase"
            value={start.phase}
            onChange={(e) => set({ phase: e.target.value })}
          >
            <option value="">Trauma-therapy phase (if applicable)</option>
            {PHASES.map(([n, l]) => (
              <option key={n} value={n}>
                {l}
              </option>
            ))}
          </select>
          <select
            className={`${INPUT} sm:col-span-2`}
            aria-label="Linked care-plan action"
            value={start.activity}
            onChange={(e) => set({ activity: e.target.value })}
          >
            <option value="">Linked care-plan action / goal (optional)</option>
            {links.map((l) => (
              <option key={l.id} value={l.id}>
                {l.title}
              </option>
            ))}
          </select>
          <label className="flex items-center gap-2 text-[13px]">
            <input
              type="checkbox"
              checked={start.consent}
              onChange={(e) => set({ consent: e.target.checked })}
            />{" "}
            Consent to record for supervision
          </label>
          <label className="flex items-center gap-2 text-[13px]">
            <input
              type="checkbox"
              checked={start.supervision}
              onChange={(e) => set({ supervision: e.target.checked })}
            />{" "}
            Flag for clinical supervision
          </label>
        </div>
        <button
          type="button"
          className={`${BTN_GHOST} ${BTN_SM} mt-2`}
          disabled={!start.modality}
          onClick={() =>
            void act((t) =>
              startTherapy(t, patientId, {
                modality: start.modality,
                planned_sessions: start.planned ? Number(start.planned) : null,
                frequency: start.frequency,
                trauma_phase: start.phase ? Number(start.phase) : null,
                consent_to_record: start.consent,
                under_supervision: start.supervision,
                activity: start.activity || null,
              }),
            ).then((ok) => ok && setStart(START))
          }
        >
          Start episode
        </button>
      </div>
      <p className="text-xs text-ink-500">
        Group and family sessions are recorded one client at a time — each person’s record stands
        alone.
      </p>
    </div>
  );
}

function TherapyEpisode({
  patientId,
  episode: e,
  state,
  act,
  kinds,
  from,
}: {
  patientId: string;
  episode: TherapyEpisodeRow;
  state: TherapyState;
  act: (work: (token: string) => Promise<unknown>) => Promise<boolean>;
  kinds: PsychotherapyKind[];
  from: string;
}) {
  const vs = useValueSets();
  const navigate = useNavigate();
  // PSY-WF: the session note is written through the Psychotherapy Session
  // workflow (five questions, mandatory safety question, review and sign),
  // opened as the routed session page so the client banner stays visible.
  // A module for one kind of session lists only that kind (Individual / Family).
  const sessionTypes = new Set<string>(
    kinds.map((k) => (k === "family" ? "FAMILY" : "INDIVIDUAL")),
  );
  const sessions = e.sessions.filter((s) => !s.session_type || sessionTypes.has(s.session_type));
  const n = e.sessions.length + 1;
  const linkTitle = (id: string) => state.link_options.find((l) => l.id === id)?.title ?? "";
  return (
    <div className="rounded-lg border border-surface-border p-3">
      <Row>
        <strong>{vs.label("therapy-modality", e.modality)}</strong>
        {e.frequency && <Tag>{e.frequency}</Tag>}
        {e.trauma_phase && <Tag>Phase {PHASES.find(([p]) => p === e.trauma_phase)?.[1]}</Tag>}
        {e.consent_to_record && <Tag>Consent to record</Tag>}
        {e.under_supervision && <Tag tone="warn">Clinical supervision</Tag>}
        {e.activity_title && <Tag tone="brand">{e.activity_title}</Tag>}
        <Tag tone={e.confidentiality_agreed ? "brand" : "warn"}>
          {e.confidentiality_agreed
            ? "Confidentiality limits agreed"
            : "Confidentiality not yet agreed"}
        </Tag>
      </Row>
      {!e.confidentiality_agreed ? (
        <div className="mt-2">
          <Callout tone="warning">
            Agree the limits of confidentiality at the start of the episode — what stays private,
            what is shared with the team, and when safety would mean sharing more. Session notes
            open once this is agreed.
          </Callout>
          <button
            type="button"
            className={`${BTN} ${BTN_SM} mt-2`}
            onClick={() => void act((t) => agreeConfidentiality(t, e.id))}
          >
            Limits explained and agreed
          </button>
        </div>
      ) : (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          {kinds.map((kind, i) => (
            <button
              key={kind}
              type="button"
              className={`${i === 0 ? BTN : BTN_GHOST} ${BTN_SM}`}
              onClick={() =>
                navigate(psychotherapySessionPath(kind, patientId, e.id), { state: { from } })
              }
            >
              {kind === "family" ? "Start family session" : "Start individual session"}
            </button>
          ))}
          <span className="text-xs text-ink-500">
            Session {n}
            {e.planned_sessions ? ` of ${e.planned_sessions}` : ""} · an open draft is resumed
          </span>
        </div>
      )}
      {sessions.length > 0 && (
        <div className="mt-3 overflow-x-auto">
          <table className={TABLE}>
            <thead>
              <tr>
                <th className={TH}>#</th>
                <th className={TH}>Date</th>
                <th className={TH}>Note</th>
                <th className={TH}>Measure</th>
                <th className={TH}>Homework</th>
                <th className={TH}>By</th>
              </tr>
            </thead>
            <tbody>
              {sessions.map((s) => (
                <tr key={s.id}>
                  <td className={TD}>{s.n}</td>
                  <td className={TD}>{formatDate(s.at)}</td>
                  <td className={TD}>
                    {s.notes.length > 120 ? `${s.notes.slice(0, 120)}…` : s.notes}
                    {s.activity && linkTitle(s.activity) && (
                      <div className="text-[11px] text-ink-500">for {linkTitle(s.activity)}</div>
                    )}
                    {s.has_process_notes && (
                      <>
                        {" "}
                        <Tag>process note (restricted)</Tag>
                      </>
                    )}
                    {s.note_id && (
                      <>
                        {" "}
                        <button
                          type="button"
                          className={`${BTN_GHOST} ${BTN_SM}`}
                          onClick={() =>
                            navigate(
                              psychotherapyNotePath(
                                s.session_type === "FAMILY" ? "family" : "individual",
                                patientId,
                                e.id,
                                s.note_id as string,
                              ),
                              { state: { from } },
                            )
                          }
                        >
                          Open note
                        </button>
                      </>
                    )}
                  </td>
                  <td className={TD}>{s.measure ? `${s.measure.name} ${s.measure.total}` : "—"}</td>
                  <td className={TD}>{s.homework || "—"}</td>
                  <td className={TD}>{s.by}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
