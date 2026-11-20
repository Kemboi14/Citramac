import { X } from "lucide-react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import { Breadcrumbs } from "./shared/Breadcrumbs";
import { SafetyBanner } from "./shared/SafetyBanner";
import { clientRecordPath } from "./shared/recordRoutes";
import { BTN_GHOST, BTN_SM } from "./shared/styles";
import { PageHeader } from "./shared/ui";
import { useClientBanner } from "./shared/useClientBanner";
import { WithdrawalModule } from "./record/modules/WithdrawalModule";

/** Withdrawal management on its own page (opened from Interventions), like the
 * psychiatry and psychotherapy modules. */
export function WithdrawalPage() {
  const { patientId = "" } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const { banner, error } = useClientBanner(patientId);
  const back = clientRecordPath(patientId, "interventions");
  const close = () => (location.key !== "default" ? navigate(-1) : navigate(back));
  return (
    <div className="clinical-readable flex flex-col gap-3">
      <Breadcrumbs
        items={[
          { label: banner ? banner.name.trim() || "Client" : "Client", to: back },
          { label: "Withdrawal management" },
        ]}
      />
      <SafetyBanner banner={banner} error={error} />
      <PageHeader
        title="Withdrawal management"
        subtitle="Score withdrawal, follow the trend, and close it when it is done"
        actions={
          <button type="button" className={`${BTN_GHOST} ${BTN_SM}`} onClick={close}>
            <X aria-hidden className="h-4 w-4" />
            Close
          </button>
        }
      />
      <WithdrawalModule patientId={patientId} />
    </div>
  );
}
