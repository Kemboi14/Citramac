import { PsychotherapySessionForm } from "./PsychotherapySessionForm";

export function FamilyTherapyPage() {
  return (
    <PsychotherapySessionForm
      sessionType="FAMILY"
      eyebrow="MHP · Family Therapy"
      title="Family Therapy Session"
      extraFieldsLabel="Family Members Present / Dynamics Observed"
    />
  );
}
