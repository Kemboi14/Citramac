import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../../auth/AuthContext";
import { usePatientContext } from "../../clinical/PatientContext";
import { ApiError } from "../../lib/apiClient";
import {
  decideClinicalReview,
  listClinicalReviews,
  requestClinicalReview,
  type ClinicalReview,
} from "../../lib/ccpExtrasApi";

const FIELD_CLASS =
  "rounded-sm border border-surface-border px-3 py-2 text-sm text-ink-900 outline-none focus:border-brand-green";
const LABEL_CLASS = "flex flex-col gap-1.5 text-sm font-medium text-ink-700";
const BUTTON_CLASS =
  "rounded-md bg-brand-green px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-brand-green-dark disabled:opacity-60";

const STATUS_TINT: Record<string, string> = {
  PENDING: "bg-ink-100 text-ink-700",
  APPROVED: "bg-brand-green-tint text-brand-green-dark",
  CHANGES_REQUESTED: "bg-status-red-tint text-status-red",
};

/** Peer/senior review before finalizing a treatment plan — docs/07-CLINICAL-MODULES-SPEC.md §7.14.5. */
export function ClinicalReviewPage() {
  const { accessToken } = useAuth();
  const { selected } = usePatientContext();

  const [caseSummary, setCaseSummary] = useState("");
  const [reviews, setReviews] = useState<ClinicalReview[]>([]);
  const [reviewNotes, setReviewNotes] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = async () => {
    if (!accessToken) return;
    setReviews((await listClinicalReviews(accessToken)).results);
  };

  useEffect(() => {
    if (!accessToken) return;
    listClinicalReviews(accessToken)
      .then((res) => setReviews(res.results))
      .catch(() => setError("Couldn't load clinical reviews."));
  }, [accessToken]);

  if (!selected) {
    return (
      <p className="text-ink-500">
        Select a client from the{" "}
        <Link to="/clinical" className="font-semibold text-brand-green hover:underline">
          Client Registry
        </Link>{" "}
        first.
      </p>
    );
  }

  const submitRequest = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!accessToken) return;
    setError(null);
    setBusy(true);
    try {
      await requestClinicalReview(accessToken, selected.patientId, caseSummary);
      setCaseSummary("");
      await refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't request a review.");
    } finally {
      setBusy(false);
    }
  };

  const decide = async (reviewId: string, status: "APPROVED" | "CHANGES_REQUESTED") => {
    if (!accessToken) return;
    setError(null);
    setBusy(true);
    try {
      // eslint-disable-next-line security/detect-object-injection
      await decideClinicalReview(accessToken, reviewId, status, reviewNotes[reviewId] ?? "");
      await refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't record the decision.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-6">
      <div>
        <div className="mb-1.5 text-[11px] font-bold uppercase tracking-wide text-brand-green">
          Module 2 · Ongoing Clinical Review
        </div>
        <h1 className="font-display text-2xl font-bold text-ink-900">
          Clinical Review — {selected.patientName}
        </h1>
      </div>

      <form
        onSubmit={submitRequest}
        className="rounded-lg border border-surface-border bg-surface-card p-6 shadow-sm"
      >
        <h2 className="mb-4 font-display text-base font-semibold text-ink-900">
          Request Peer/Senior Review
        </h2>
        <label className={LABEL_CLASS}>
          Case summary
          <textarea
            className={FIELD_CLASS}
            rows={3}
            value={caseSummary}
            onChange={(e) => setCaseSummary(e.target.value)}
            required
          />
        </label>
        <button type="submit" disabled={busy} className={`${BUTTON_CLASS} mt-4`}>
          Request Review
        </button>
      </form>

      <div className="rounded-lg border border-surface-border bg-surface-card p-6 shadow-sm">
        <h2 className="mb-4 font-display text-base font-semibold text-ink-900">
          Reviews for this Client
        </h2>
        <div className="flex flex-col gap-3">
          {reviews
            .filter((r) => r.patient === selected.patientId)
            .map((r) => (
              <div key={r.id} className="rounded-sm border border-surface-border p-3">
                <div className="flex items-center justify-between">
                  <span className="text-sm text-ink-700">{r.case_summary}</span>
                  <span
                    className={`rounded-sm px-2 py-0.5 text-xs font-semibold ${
                      STATUS_TINT[r.status] ?? ""
                    }`}
                  >
                    {r.status}
                  </span>
                </div>
                {r.status === "PENDING" && (
                  <div className="mt-3 flex items-end gap-2">
                    <input
                      className={`${FIELD_CLASS} flex-1`}
                      placeholder="Review notes"
                      value={reviewNotes[r.id] ?? ""}
                      onChange={(e) => setReviewNotes((n) => ({ ...n, [r.id]: e.target.value }))}
                    />
                    <button
                      type="button"
                      disabled={busy}
                      className={BUTTON_CLASS}
                      onClick={() => decide(r.id, "APPROVED")}
                    >
                      Approve
                    </button>
                    <button
                      type="button"
                      disabled={busy}
                      className="rounded-md border border-status-red px-4 py-2 text-sm font-semibold text-status-red hover:bg-status-red-tint disabled:opacity-60"
                      onClick={() => decide(r.id, "CHANGES_REQUESTED")}
                    >
                      Request Changes
                    </button>
                  </div>
                )}
              </div>
            ))}
        </div>
      </div>

      {error && (
        <p className="rounded-sm bg-status-red-tint px-3 py-2 text-sm text-status-red">{error}</p>
      )}
    </div>
  );
}
