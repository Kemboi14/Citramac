import { PsychotherapySessionForm } from "./PsychotherapySessionForm";

export function IndividualPsychotherapyPage() {
  return (
    <PsychotherapySessionForm
      sessionType="INDIVIDUAL"
      eyebrow="CCP · Individual Psychotherapy"
      title="Individual Session Form"
      extraFieldsLabel="Homework / Next Session Focus"
    />
  );
}
