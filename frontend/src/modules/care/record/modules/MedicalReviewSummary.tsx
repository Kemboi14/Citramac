import type { ReactNode } from "react";
import { getMedicalReviewSummary, type VitalRow } from "../../../../lib/carePathwayApi";
import { formatDateTime } from "../../shared/format";
import { ErrorNote } from "../../shared/ui";
import { useRecordData } from "../useRecordData";

// The EWS response colours the observation charts use (ChartsView).
const TONE: Record<string, string> = {
  ok: "border-brand-green bg-brand-green-tint text-brand-green-dark",
  warn: "border-priority-orange bg-priority-orange-tint text-priority-orange",
  bad: "border-priority-red bg-priority-red-tint text-priority-red",
};

function Section({
  title,
  source,
  children,
}: {
  title: string;
  source?: string;
  children: ReactNode;
}) {
  return (
    <section className="border-t border-surface-border py-2.5 first:border-t-0">
      <h4 className="text-[11px] font-bold uppercase tracking-[.35px] text-ink-500">
        {title}
        {source && (
          <span className="ml-2 font-normal normal-case tracking-normal text-ink-400">
            {source}
          </span>
        )}
      </h4>
      <div className="mt-1.5 text-[13px] text-ink-900">{children}</div>
    </section>
  );
}

function None({ children }: { children: ReactNode }) {
  return <p className="text-ink-500">{children}</p>;
}

function vitalParts(v: VitalRow): string[] {
  const parts: string[] = [];
  if (v.systolic_bp != null && v.diastolic_bp != null)
    parts.push(`BP ${v.systolic_bp}/${v.diastolic_bp}`);
  if (v.heart_rate != null) parts.push(`HR ${v.heart_rate}`);
  if (v.respiratory_rate != null) parts.push(`RR ${v.respiratory_rate}`);
  if (v.temperature_c != null) parts.push(`Temp ${v.temperature_c} °C`);
  if (v.spo2 != null) parts.push(`SpO₂ ${v.spo2}%${v.supplemental_o2 ? " (on O₂)" : ""}`);
  if (v.blood_glucose_mmol != null) parts.push(`Glucose ${v.blood_glucose_mmol} mmol/L`);
  if (v.consciousness) parts.push(`AVPU ${v.consciousness}`);
  return parts;
}

/** Medical review — what the record already holds, read-only, so the reviewer
 * starts from the latest observations, allergies, medicines and medical
 * history instead of asking again. Nothing here is copied or stored. */
export function MedicalReviewSummary({ patientId }: { patientId: string }) {
  const { data, error } = useRecordData(
    patientId,
    0,
    (token) => getMedicalReviewSummary(token, patientId),
    "Couldn't load the medical review summary.",
  );
  if (error) return <ErrorNote>{error}</ErrorNote>;
  if (!data) return <p className="text-[13px] text-ink-500">Loading…</p>;
  const { vitals, allergies, medicines, reported_medicines, intake } = data;

  return (
    <div>
      <Section
        title="Latest vital signs"
        source={
          vitals ? `${formatDateTime(vitals.recorded_at)} · ${vitals.recorded_by}` : undefined
        }
      >
        {vitals ? (
          <>
            <p>{vitalParts(vitals).join(" · ") || "No values recorded in this set"}</p>
            {vitals.ews && (
              <p
                role="status"
                className={`mt-1.5 rounded-lg border px-3 py-2 font-semibold ${
                  TONE[vitals.ews.response.tone] ?? TONE.ok
                }`}
              >
                {vitals.ews.label} — {vitals.ews.response.text}
              </p>
            )}
          </>
        ) : (
          <None>No vital signs recorded</None>
        )}
      </Section>

      <Section title="Allergies">
        {allergies.length ? (
          <ul className="flex flex-col gap-1">
            {allergies.map((a) => (
              <li key={`${a.substance}-${a.type}`}>
                <span className="font-semibold">{a.substance}</span>
                {[a.reaction, a.severity, a.type, a.verified].filter(Boolean).length > 0 && (
                  <span className="text-ink-500">
                    {" — "}
                    {[a.reaction, a.severity, a.type, a.verified].filter(Boolean).join(" · ")}
                  </span>
                )}
              </li>
            ))}
          </ul>
        ) : (
          <None>No active allergies recorded</None>
        )}
      </Section>

      <Section title="Recent prescriptions" source="latest 10">
        {medicines.length ? (
          <ul className="flex flex-col gap-1">
            {medicines.map((m, i) => (
              <li key={`${m.drug}-${m.prescribed_on}-${i}`}>
                <span className="font-semibold">{m.drug || "Unnamed medicine"}</span>{" "}
                {[m.dose, m.route, m.frequency, m.duration].filter(Boolean).join(" · ")}
                <span className="block text-[11.5px] text-ink-500">
                  {[m.prescribed_on, m.prescribed_by].filter(Boolean).join(" · ")}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <None>No prescriptions recorded</None>
        )}
      </Section>

      <Section title="Medicines the client reported" source="intake medication history">
        {reported_medicines.length ? (
          <ul className="flex flex-col gap-1">
            {reported_medicines.map((m, i) => (
              <li key={`${m.name}-${i}`}>
                <span className="font-semibold">{m.name}</span>{" "}
                {[m.dose, m.route, m.frequency, m.status].filter(Boolean).join(" · ")}
              </li>
            ))}
          </ul>
        ) : (
          <None>None reported</None>
        )}
      </Section>

      <Section
        title="Medical & neurological history"
        source={intake.signed_at ? `signed intake, ${formatDateTime(intake.signed_at)}` : undefined}
      >
        {!intake.signed_at ? (
          <None>No signed intake yet</None>
        ) : intake.history.length ? (
          <dl className="grid grid-cols-[minmax(120px,40%)_1fr] gap-x-3 gap-y-1">
            {intake.history.map((row) => (
              <div key={row.label} className="contents">
                <dt className="text-ink-500">{row.label}</dt>
                <dd>{row.value}</dd>
              </div>
            ))}
          </dl>
        ) : (
          <None>Nothing recorded in this section of the signed intake</None>
        )}
      </Section>
    </div>
  );
}
