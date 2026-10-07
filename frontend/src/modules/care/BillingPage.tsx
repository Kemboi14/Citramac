import { useEffect, useState } from "react";
import { useAuth } from "../../auth/useAuth";
import { ApiError } from "../../lib/apiClient";
import { getBillingOverview, type BillingOverview } from "../../lib/carePathwayApi";
import { BillingOverviewView } from "./billing/BillingOverviewView";
import { PageHeader } from "./shared/ui";

// docs/15-CLINICAL-WORKSPACE-V3.md §1.15 — mockup billing().

export function BillingPage() {
  const { accessToken, claims } = useAuth();
  const [overview, setOverview] = useState<BillingOverview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!accessToken) return;
    let cancelled = false;
    getBillingOverview(accessToken)
      .then((data) => !cancelled && setOverview(data))
      .catch(
        (err) =>
          !cancelled &&
          setError(err instanceof ApiError ? err.message : "Billing records could not be loaded."),
      )
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [accessToken]);

  return (
    <div className="animate-fade-in">
      <PageHeader
        eyebrow={`Finance overview · ${new Date().toLocaleDateString()}`}
        title="Billing"
        subtitle="A live view of delivered services, outstanding claims, and payments"
      />
      <BillingOverviewView
        overview={overview}
        error={error}
        loading={loading}
        showTariffLink={claims?.role === "Org Admin"}
      />
    </div>
  );
}
