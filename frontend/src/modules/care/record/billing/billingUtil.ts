import type { BillingWorkspace, PayerClaim } from "../../../../lib/claimsApi";
import { formatKsh } from "../../shared/format";

// Helpers shared by the claim workspace and its SHA panels.

/** Runs a write that returns the refreshed workspace; false when refused. */
export type Run = (action: () => Promise<BillingWorkspace>, success?: string) => Promise<boolean>;

/** Runs a call that does not return the workspace (search, OTP send, preview);
 * null when refused — the refusal is shown in the workspace's error note. */
export type Ask = <T>(
  action: () => Promise<T>,
  success?: (result: T) => string | undefined,
) => Promise<T | null>;

export function money(amount: string | number | null | undefined) {
  return amount == null ? "—" : formatKsh(amount);
}

/** A yes/no answer from SHA, shown without interpretation. */
export function yesNo(value: boolean | null | undefined) {
  return value == null ? "Not stated by SHA" : value ? "Yes" : "No";
}

/** SHA claim documents can change while it is a draft, or after SHA returns it. */
export function shaDocumentsEditable(claim: PayerClaim) {
  return claim.status === "DRAFT" || claim.status === "RETURNED";
}
