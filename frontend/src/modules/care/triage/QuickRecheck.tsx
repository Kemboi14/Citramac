import { useEffect, useRef, useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../../../auth/useAuth";
import {
  PRIORITY_LABEL,
  requestFullRetriage,
  saveRecheckDraft,
  signRecheck,
  type ObservationStatus,
  type RecheckObservations,
  type RecheckPayload,
  type TriageEncounterDetail,
} from "../../../lib/carePathwayApi";
import { formatTime } from "../shared/format";
import { BTN, BTN_GHOST, INPUT } from "../shared/styles";
import { ErrorNote, SelectChoices } from "../shared/ui";
import { useValueSets } from "../shared/useValueSets";
import { FIELDGRID, REQUIRED_MARK, errorText } from "./helpers";

// docs/15-CLINICAL-WORKSPACE-V3.md §1.7 — mockup triageQuickRecheck() and
// initQuickRecheck(). Blood pressure is one card with one status shared by the
// systolic and diastolic payload entries.

type CardKey =
  | "heartRate"
  | "bloodPressure"
  | "respiratoryRate"
  | "temperature"
  | "oxygenSaturation"
  | "bloodGlucose";

const CARDS: { key: CardKey; label: string; unit: string }[] = [
  { key: "heartRate", label: "Heart rate", unit: "bpm" },
  { key: "bloodPressure", label: "Blood pressure — systolic / diastolic", unit: "mmHg" },
  { key: "respiratoryRate", label: "Respiratory rate", unit: "/min" },
  { key: "temperature", label: "Temperature", unit: "°C" },
  { key: "oxygenSaturation", label: "SpO₂", unit: "%" },
  { key: "bloodGlucose", label: "Blood glucose", unit: "mmol/L" },
];

const FIELD_LABELS: Record<string, string> = {
  change_since_last_check: "Any change since the last check",
  heartRate: "Heart rate",
  bloodPressureSystolic: "Blood pressure systolic",
  bloodPressureDiastolic: "Blood pressure diastolic",
  respiratoryRate: "Respiratory rate",
  temperature: "Temperature",
  oxygenSaturation: "SpO₂",
  bloodGlucose: "Blood glucose",
};

interface CardState {
  status: ObservationStatus;
  value: string;
  /** Diastolic, for the blood-pressure card only. */
  value2: string;
}

type Cards = Record<CardKey, CardState>;

function initialCards(saved: RecheckObservations | undefined): Cards {
  const read = (key: string) => {
    const entry = saved ? new Map(Object.entries(saved)).get(key) : undefined;
    return { value: entry?.value ?? "", status: entry?.status ?? "NOT_REPEATED" };
  };
  const single = (key: string): CardState => {
    const entry = read(key);
    return { status: entry.status, value: entry.value, value2: "" };
  };
  const systolic = read("bloodPressureSystolic");
  const diastolic = read("bloodPressureDiastolic");
  return {
    heartRate: single("heartRate"),
    bloodPressure: { status: systolic.status, value: systolic.value, value2: diastolic.value },
    respiratoryRate: single("respiratoryRate"),
    temperature: single("temperature"),
    oxygenSaturation: single("oxygenSaturation"),
    bloodGlucose: single("bloodGlucose"),
  };
}

function toObservations(cards: Cards): RecheckObservations {
  const one = (c: CardState) => ({ value: c.value, status: c.status });
  return {
    heartRate: one(cards.heartRate),
    bloodPressureSystolic: { value: cards.bloodPressure.value, status: cards.bloodPressure.status },
    bloodPressureDiastolic: {
      value: cards.bloodPressure.value2,
      status: cards.bloodPressure.status,
    },
    respiratoryRate: one(cards.respiratoryRate),
    temperature: one(cards.temperature),
    oxygenSaturation: one(cards.oxygenSaturation),
    bloodGlucose: one(cards.bloodGlucose),
  };
}

const RC_INPUT = `${INPUT} !bg-surface-card !px-2.5 !py-[9px]`;
const RC_LABEL = "text-xs font-semibold text-ink-900";

export function QuickRecheck({
  detail,
  onFullRetriage,
}: {
  detail: TriageEncounterDetail;
  onFullRetriage: () => void;
}) {
  const { accessToken } = useAuth();
  const navigate = useNavigate();
  const vs = useValueSets();
  const draft = detail.recheck_draft;

  const [change, setChange] = useState(draft?.change_since_last_check ?? "");
  const [distress, setDistress] = useState(draft?.distress_behaviour || "LOW");
  const [cards, setCards] = useState<Cards>(() => initialCards(draft?.observations));
  const [note, setNote] = useState(draft?.note ?? "");
  const [draftStatus, setDraftStatus] = useState(
    draft?.draft_saved_at ? `Draft saved ${formatTime(draft.draft_saved_at)}` : "Draft not saved",
  );
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Latest values for the debounced autosave (avoids a stale closure).
  const latest = useRef<RecheckPayload>({
    change_since_last_check: change,
    distress_behaviour: distress,
    observations: toObservations(cards),
    note,
  });
  const timer = useRef<number | undefined>(undefined);
  const seq = useRef(0);
  const done = useRef(false);

  useEffect(
    () => () => {
      window.clearTimeout(timer.current);
    },
    [],
  );

  function scheduleSave(patch: Partial<RecheckPayload>) {
    latest.current = { ...latest.current, ...patch };
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(saveNow, 500);
  }

  function saveNow() {
    if (!accessToken || done.current) return;
    const mine = ++seq.current;
    saveRecheckDraft(accessToken, detail.id, latest.current)
      .then((saved) => {
        if (mine !== seq.current || done.current) return;
        setDraftStatus(`Draft saved ${formatTime(saved.draft_saved_at)}`);
      })
      .catch(() => {
        if (mine !== seq.current || done.current) return;
        setDraftStatus("Draft not saved — check your connection");
      });
  }

  function updateCard(key: CardKey, patch: Partial<CardState>) {
    // One update per event, so reading the rendered `cards` is current here.
    // eslint-disable-next-line security/detect-object-injection -- `key` is the CardKey union.
    let nextCard: CardState = { ...cards[key], ...patch };
    if (patch.status && patch.status !== "MEASURED") {
      // Moving away from Measured clears the value (mockup initQuickRecheck).
      nextCard = { ...nextCard, value: "", value2: "" };
    } else if (!patch.status && (patch.value || patch.value2)) {
      // Typing a value marks the observation as measured now.
      nextCard = { ...nextCard, status: "MEASURED" };
    }
    const next = { ...cards, [key]: nextCard };
    setCards(next);
    scheduleSave({ observations: toObservations(next) });
  }

  async function onSign(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!accessToken || busy) return;
    if (!event.currentTarget.reportValidity()) return;
    window.clearTimeout(timer.current);
    setBusy(true);
    setError(null);
    try {
      await signRecheck(accessToken, detail.id, latest.current);
      done.current = true;
      navigate("/clinical/triage");
    } catch (err) {
      setError(
        errorText(
          err,
          "Re-check not signed — couldn't reach the server. Check your connection and try again.",
          FIELD_LABELS,
        ),
      );
    } finally {
      setBusy(false);
    }
  }

  async function onFull() {
    if (!accessToken || busy) return;
    window.clearTimeout(timer.current);
    setBusy(true);
    setError(null);
    try {
      await requestFullRetriage(accessToken, detail.id);
      done.current = true;
      onFullRetriage();
    } catch (err) {
      setError(errorText(err, "Couldn't open a full re-triage — check your connection."));
      setBusy(false);
    }
  }

  const priority = detail.priority;
  // eslint-disable-next-line security/detect-object-injection -- `priority` is the Priority union.
  const priorityLabel = priority ? PRIORITY_LABEL[priority] : "";
  const prior = detail.last_triaged_at
    ? `Last signed: triage v${detail.triage_version || 1} at ${formatTime(detail.last_triaged_at)}${
        detail.last_triaged_by ? ` by ${detail.last_triaged_by}` : ""
      }${priority ? ` — ${priority} ${priorityLabel}` : ""}.`
    : "No previous signed triage time is recorded.";
  const statusOptions = vs.options("recheck-observation-status");

  return (
    <form onSubmit={onSign}>
      <section className="mb-4 rounded-lg border border-surface-border bg-surface-card shadow-sm">
        <div className="px-[18px] pb-2 pt-[18px]">
          <div className="text-[10px] font-semibold uppercase tracking-[.5px] text-ink-500">
            Visit {detail.visit_number} · Is anything different since the last check?
          </div>
          <h2 className="my-[5px] font-display text-[23px] font-semibold text-ink-900">
            Quick re-check
          </h2>
          <p className="mt-1.5 max-w-[760px] text-[13px] leading-normal text-ink-500">
            {prior} A re-check takes about 30 seconds; open a full re-triage if anything has
            changed.
          </p>
        </div>
        <div className="px-[18px] pb-[18px] pt-2.5">
          <div className={FIELDGRID}>
            <div className="flex min-w-0 flex-col gap-1">
              <label htmlFor="recheck-change" className={RC_LABEL}>
                Any change since the last check (client, family or staff report)?{" "}
                <span className={REQUIRED_MARK}>REQUIRED</span>
              </label>
              <SelectChoices
                id="recheck-change"
                required
                options={vs.options("recheck-change")}
                placeholder="— select —"
                value={change}
                onChange={(value) => {
                  setChange(value);
                  scheduleSave({ change_since_last_check: value });
                }}
              />
            </div>
            <div className="flex min-w-0 flex-col gap-1">
              <label htmlFor="recheck-distress" className={RC_LABEL}>
                Distress / behaviour now
              </label>
              <SelectChoices
                id="recheck-distress"
                options={vs.options("recheck-distress")}
                value={distress}
                onChange={(value) => {
                  setDistress(value);
                  scheduleSave({ distress_behaviour: value });
                }}
              />
            </div>
          </div>

          <div className="mb-2.5 mt-5 flex flex-wrap items-baseline gap-2 text-[13px] text-ink-900">
            <strong>Repeat observations</strong>
            <span className="text-xs text-ink-500">
              Leave blank if not repeated — the previous set carries forward.
            </span>
          </div>
          <div className="grid grid-cols-1 gap-2.5 min-[561px]:grid-cols-2 min-[901px]:grid-cols-4">
            {CARDS.map(({ key, label, unit }) => {
              // eslint-disable-next-line security/detect-object-injection -- `key` is the CardKey union.
              const card = cards[key];
              const measured = card.status === "MEASURED";
              const inputId = `recheck-${key}`;
              return (
                <div
                  key={key}
                  className="flex min-w-0 flex-col gap-2 rounded-lg border border-surface-border p-2.5"
                >
                  <label htmlFor={inputId} className={RC_LABEL}>
                    {label}
                  </label>
                  {key === "bloodPressure" ? (
                    <div className="flex items-center gap-1.5">
                      <input
                        id={inputId}
                        type="number"
                        step={1}
                        inputMode="numeric"
                        aria-label="Blood pressure systolic"
                        placeholder="sys"
                        required={measured}
                        className={`${RC_INPUT} !w-[72px]`}
                        value={card.value}
                        onChange={(e) => updateCard(key, { value: e.target.value })}
                      />
                      <span className="text-ink-500">/</span>
                      <input
                        type="number"
                        step={1}
                        inputMode="numeric"
                        aria-label="Blood pressure diastolic"
                        placeholder="dia"
                        required={measured}
                        className={`${RC_INPUT} !w-[72px]`}
                        value={card.value2}
                        onChange={(e) => updateCard(key, { value2: e.target.value })}
                      />
                      <span className="flex-none text-[11px] text-ink-500">{unit}</span>
                    </div>
                  ) : (
                    <div className="flex items-center gap-2">
                      <input
                        id={inputId}
                        type="number"
                        step="any"
                        inputMode="decimal"
                        required={measured}
                        className={RC_INPUT}
                        value={card.value}
                        onChange={(e) => updateCard(key, { value: e.target.value })}
                      />
                      <span className="flex-none text-[11px] text-ink-500">{unit}</span>
                    </div>
                  )}
                  <select
                    aria-label={`${label} measurement status`}
                    className={`${RC_INPUT} !text-[11px]`}
                    value={card.status}
                    onChange={(e) =>
                      updateCard(key, { status: e.target.value as ObservationStatus })
                    }
                  >
                    {statusOptions.map((option) => (
                      <option key={option.code} value={option.code}>
                        {option.display}
                      </option>
                    ))}
                  </select>
                </div>
              );
            })}
          </div>
          <div className="mt-3.5 flex min-w-0 flex-col gap-1">
            <label htmlFor="recheck-note" className={RC_LABEL}>
              Note (optional)
            </label>
            <textarea
              id="recheck-note"
              rows={2}
              placeholder="Record a brief change or observation"
              className={RC_INPUT}
              value={note}
              onChange={(e) => {
                setNote(e.target.value);
                scheduleSave({ note: e.target.value });
              }}
            />
          </div>
        </div>
      </section>
      {(error || vs.error) && (
        <div className="mb-3">
          <ErrorNote>{error ?? vs.error}</ErrorNote>
        </div>
      )}
      <div className="sticky bottom-0 z-20 -mx-4 flex flex-col items-start justify-between gap-3 border-t border-surface-border bg-surface-card/95 px-4 py-3 shadow-[0_-6px_18px_rgba(18,38,34,.06)] backdrop-blur min-[561px]:flex-row min-[561px]:items-center sm:-mx-6 sm:px-6 lg:-mx-8 lg:px-8">
        <span role="status" className="text-xs text-ink-500">
          {draftStatus}
        </span>
        <div className="flex w-full flex-wrap items-center gap-2 min-[561px]:w-auto [&>button]:flex-auto min-[561px]:[&>button]:flex-none">
          <button type="button" className={BTN_GHOST} onClick={() => navigate("/clinical/triage")}>
            Back
          </button>
          <button type="button" className={BTN_GHOST} disabled={busy} onClick={onFull}>
            Open full re-triage
          </button>
          <button type="submit" className={BTN} disabled={busy}>
            Sign re-check
          </button>
        </div>
      </div>
    </form>
  );
}
