import { PsychotherapySessionForm } from "./PsychotherapySessionForm";

export function GroupPsychotherapyPage() {
  return (
    <PsychotherapySessionForm
      sessionType="GROUP"
      eyebrow="CCP · Group Psychotherapy"
      title="Group Session"
      extraFieldsLabel="Topic / Facilitator Observations"
    />
  );
}
