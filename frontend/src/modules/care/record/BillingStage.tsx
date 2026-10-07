import { useEffect, useState } from "react";
import { useAuth } from "../../../auth/useAuth";
import { ApiError } from "../../../lib/apiClient";
import { getClientBilling, type BillingOverview } from "../../../lib/carePathwayApi";
import { BillingOverviewView } from "../billing/BillingOverviewView";

// Client record → Journey → "Billing" (doc 15 §1.9, §1.15): the billing
// overview filtered to one client.

export function BillingStage({ patientId }: { patientId: string }) {
  const { accessToken, claims } = useAuth();
  const [result, setResult] = useState<{
    patientId: string;
    overview: BillingOverview | null;
    error: string | null;
  } | null>(null);

  useEffect(() => {
    if (!accessToken || !patientId) return;
    let cancelled = false;
    getClientBilling(accessToken, patientId)
      .then((overview) => !cancelled && setResult({ patientId, overview, error: null }))
      .catch(
        (err) =>
          !cancelled &&
          setResult({
            patientId,
            overview: null,
            error:
              err instanceof ApiError ? err.message : "This client's billing could not be loaded.",
          }),
      );
    return () => {
      cancelled = true;
    };
  }, [accessToken, patientId]);

  // A result for a previously viewed client is never shown for this one.
  const current = result?.patientId === patientId ? result : null;

  return (
    <section aria-labelledby="billing-stage-title">
      <div className="mb-4">
        <h2 id="billing-stage-title" className="font-display text-base font-semibold text-ink-900">
          Billing
        </h2>
        <p className="mt-0.5 text-[12.5px] text-ink-500">
          Charges generated from this client’s documented delivered services
        </p>
      </div>
      <BillingOverviewView
        overview={current?.overview ?? null}
        error={current?.error ?? null}
        loading={!current}
        showTariffLink={claims?.role === "Org Admin"}
      />
    </section>
  );
}
