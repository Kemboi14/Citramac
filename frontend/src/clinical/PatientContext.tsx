import { useCallback, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { PatientContext, type SelectedPatient } from "./patientContextObject";

/**
 * Holds the "currently open" patient + encounter, mirroring the mockups'
 * persistent patient-banner (mockups/citramac_clinical_workspace.html) that
 * carries across Triage/MSE, Clinical Encounter, and MHP session tabs.
 *
 * In memory only (CLAUDE.md §5: no browser storage for clinical data — a
 * client's identity and open encounter are exactly that). A page reload or a
 * sign-out forgets the selection; every screen that needs a client offers a
 * search box (ClientPicker) so choosing again takes a few keystrokes.
 */
export function PatientProvider({ children }: { children: ReactNode }) {
  const [selected, setSelected] = useState<SelectedPatient | null>(() => {
    // Remove what earlier versions kept in this tab's session storage.
    try {
      sessionStorage.removeItem("citramac.selectedPatient");
    } catch {
      // Storage may be blocked; nothing to clean up then.
    }
    return null;
  });

  const selectPatient = useCallback((patientId: string, patientName: string) => {
    setSelected({ patientId, patientName, encounterId: null });
  }, []);

  const setEncounter = useCallback((encounterId: string) => {
    setSelected((current) => (current ? { ...current, encounterId } : current));
  }, []);

  const clear = useCallback(() => setSelected(null), []);

  const value = useMemo(
    () => ({ selected, selectPatient, setEncounter, clear }),
    [selected, selectPatient, setEncounter, clear],
  );

  return <PatientContext.Provider value={value}>{children}</PatientContext.Provider>;
}
