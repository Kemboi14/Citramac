import type { InterventionModule } from "../../../../lib/carePathwayApi";
import { formatKsh } from "../../shared/format";

/** The price part of a module's meta line (v4 `moduleCard`). Rates come from
 * the facility tariff; a missing one is said to be missing, never assumed. */
export function priceText(module: InterventionModule) {
  if (!module.billing_service) return "Not separately billable";
  if (module.rate === null) return "No rate configured in Billing";
  return `${formatKsh(module.rate)}${module.unit ? ` / ${module.unit}` : ""}`;
}

/** Price · configured SHA code · pre-auth — nothing here is a guessed code. */
export function metaParts(module: InterventionModule) {
  return [priceText(module), module.sha_code && `SHA ${module.sha_code}`].filter(Boolean) as string[];
}

/** "3 sessions delivered" in the module's unit. */
export function deliveredText(module: InterventionModule) {
  const unit = module.unit || "item";
  return `${module.delivered} ${unit}${module.delivered === 1 ? "" : "s"} delivered`;
}

/** The note beside "Record delivery". */
export function billingNote(module: InterventionModule) {
  if (module.charged_by) {
    return `Charged when ${module.charged_by} — recording here adds no second charge`;
  }
  if (module.billing_service && !module.billable) {
    return `${module.billing_service} is not set up in Billing — no charge is created`;
  }
  if (module.rate !== null) return `${formatKsh(module.rate)} per ${module.unit || "item"}`;
  return priceText(module);
}
