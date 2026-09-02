import { useContext } from "react";
import { PatientContext } from "./patientContextObject";

// Split from PatientContext.tsx so that file only exports the
// `PatientProvider` component — a file exporting both a component and a
// hook breaks Fast Refresh (react-refresh/only-export-components).
export function usePatientContext() {
  const context = useContext(PatientContext);
  if (!context) throw new Error("usePatientContext must be used within a PatientProvider");
  return context;
}
