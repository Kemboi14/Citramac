import type { InterventionModule } from "../../../../lib/carePathwayApi";
import { formatKsh } from "../../shared/format";

/** Module meta line (mockup `interventionRateText`). Rates come from the
 * facility tariff; a missing one is said to be missing, never assumed. */
export function rateText(module: InterventionModule) {
  if (!module.billing_service) return "Not separately priced in Billing";
  return module.rate !== null
    ? `${formatKsh(module.rate)} · rate configured in Billing`
    : "No rate configured in Billing";
}

/** The drawer footer's billing note beside "Record delivery". */
export function billingNote(module: InterventionModule) {
  if (module.charged_by) {
    return `Charged when ${module.charged_by} — recording here adds no second charge`;
  }
  if (module.billing_service && !module.billable) {
    return `${module.billing_service} is not set up in Billing — no charge is created`;
  }
  return module.rate !== null
    ? `${formatKsh(module.rate)} rate configured in Billing`
    : rateText(module);
}
