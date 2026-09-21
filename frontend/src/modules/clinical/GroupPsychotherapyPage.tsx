import { PsychotherapySessionForm } from "./PsychotherapySessionForm";

export function GroupPsychotherapyPage() {
  return (
    <PsychotherapySessionForm
      sessionType="GROUP"
      eyebrow="MHP · Group Psychotherapy"
      title="Group Session"
      extraFieldsLabel="Topic / Facilitator Observations"
    />
  );
}
