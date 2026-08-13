import { PsychotherapySessionForm } from "./PsychotherapySessionForm";

export function FamilyTherapyPage() {
  return (
    <PsychotherapySessionForm
      sessionType="FAMILY"
      eyebrow="CCP · Family Therapy"
      title="Family Therapy Session"
      extraFieldsLabel="Family Members Present / Dynamics Observed"
    />
  );
}
