import { SafetyBanner } from "../modules/care/shared/SafetyBanner";
import { useClientBanner } from "../modules/care/shared/useClientBanner";
import { usePatientContext } from "./usePatientContext";

/**
 * The persistent safety banner for the client a screen is working on, with a
 * way to switch client. Renders nothing until a client is chosen.
 */
export function ClientContext() {
  const { selected, clear } = usePatientContext();
  const { banner, error } = useClientBanner(selected?.patientId);
  if (!selected) return null;
  return (
    <div className="mb-4">
      <SafetyBanner banner={banner} error={error} />
      <div className="-mt-2 flex justify-end">
        <button
          type="button"
          onClick={clear}
          className="text-[12px] font-semibold text-brand-green hover:underline"
        >
          Change client
        </button>
      </div>
    </div>
  );
}
