import { useCallback, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { PatientContext, type SelectedPatient } from "./patientContextObject";

const STORAGE_KEY = "citramac.selectedPatient";

/**
 * Holds the "currently open" patient + encounter, mirroring the mockups'
 * persistent patient-banner (mockups/citramac_clinical_workspace.html) that
 * carries across Triage/MSE, Clinical Encounter, and CCP session tabs.
 * sessionStorage-backed so a page refresh mid-encounter doesn't lose it.
 */
export function PatientProvider({ children }: { children: ReactNode }) {
  const [selected, setSelected] = useState<SelectedPatient | null>(() => {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as SelectedPatient) : null;
  });

  const persist = useCallback((value: SelectedPatient | null) => {
    setSelected(value);
    if (value) sessionStorage.setItem(STORAGE_KEY, JSON.stringify(value));
    else sessionStorage.removeItem(STORAGE_KEY);
  }, []);

  const selectPatient = useCallback(
    (patientId: string, patientName: string) => {
      persist({ patientId, patientName, encounterId: null });
    },
    [persist],
  );

  const setEncounter = useCallback(
    (encounterId: string) => {
      if (!selected) return;
      persist({ ...selected, encounterId });
    },
    [selected, persist],
  );

  const clear = useCallback(() => persist(null), [persist]);

  const value = useMemo(
    () => ({ selected, selectPatient, setEncounter, clear }),
    [selected, selectPatient, setEncounter, clear],
  );

  return <PatientContext.Provider value={value}>{children}</PatientContext.Provider>;
}
