import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../auth/useAuth";
import { createEncounter } from "../lib/clinicalApi";
import { usePatientContext } from "./usePatientContext";

/**
 * Every clinical tab (Triage/MSE, Clinical Encounter, CCP sessions) needs an
 * open Encounter for the selected patient — docs/06-DATA-MODEL.md §6.3's
 * "umbrella object every clinical touchpoint attaches to". Redirects to the
 * Client Registry if no patient is selected; otherwise reuses the
 * encounter already in PatientContext or opens a new one.
 */
export function useEnsureEncounter() {
  const { accessToken } = useAuth();
  const { selected, setEncounter } = usePatientContext();
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);
  // A ref, not state — this only guards against double-firing the create
  // call (e.g. React StrictMode's double-invoke); it doesn't need a re-render.
  const isCreatingRef = useRef(false);

  useEffect(() => {
    if (!selected) {
      navigate("/clinical/registry", { replace: true });
      return;
    }
    if (selected.encounterId || !accessToken || isCreatingRef.current) return;

    isCreatingRef.current = true;
    createEncounter(accessToken, selected.patientId, "OUTPATIENT")
      .then((encounter) => setEncounter(encounter.id))
      .catch(() => setError("Couldn't open an encounter for this client."))
      .finally(() => {
        isCreatingRef.current = false;
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected?.patientId, selected?.encounterId]);

  return {
    encounterId: selected?.encounterId ?? null,
    patientName: selected?.patientName ?? "",
    error,
  };
}
