import { createContext } from "react";

export interface SelectedPatient {
  patientId: string;
  patientName: string;
  encounterId: string | null;
}

export interface PatientContextValue {
  selected: SelectedPatient | null;
  selectPatient: (patientId: string, patientName: string) => void;
  setEncounter: (encounterId: string) => void;
  clear: () => void;
}

// Split from PatientContext.tsx (the `PatientProvider` component) and
// usePatientContext.ts (the hook) into its own module — a file exporting a
// React context alongside a component or hook breaks Fast Refresh
// (react-refresh/only-export-components).
export const PatientContext = createContext<PatientContextValue | undefined>(undefined);
