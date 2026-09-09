import { useEffect, useState } from "react";
import { FileText, Paperclip, Star } from "lucide-react";
import { useAuth } from "../../auth/useAuth";
import { DocumentLibrary } from "../../components/DocumentLibrary";
import { DonutChart } from "../../components/charts/DonutChart";
import { StatCard } from "../../components/StatCard";
import {
  getAttachmentInsights,
  type AttachmentCategory,
  type AttachmentInsights,
} from "../../lib/attachmentsApi";

const CATEGORY_LABEL: Record<AttachmentCategory, string> = {
  IDENTITY: "Identity Documents",
  CLINICAL: "Clinical Documents",
  ASSESSMENT: "Assessments",
  REFERRAL: "Referrals",
  LAB_RESULT: "Lab Results",
  IMAGING: "Imaging",
  CONSENT: "Consents",
  CORRESPONDENCE: "Correspondence",
  OTHER: "Other",
};

/**
 * Global document manager — rebuilt on the shared `DocumentLibrary`
 * (category sidebar + table + preview pane) from the second (2026-09)
 * clinical-workspace mockup. Document Insights (stat cards + category
 * donut) stay above it — real aggregate counts, kept from the previous
 * build rather than dropped.
 */
export function AttachmentsPage() {
  const { accessToken } = useAuth();
  const [insights, setInsights] = useState<AttachmentInsights | null>(null);

  useEffect(() => {
    if (!accessToken) return;
    getAttachmentInsights(accessToken)
      .then(setInsights)
      .catch(() => undefined);
  }, [accessToken]);

  const categoryChartData = Object.entries(insights?.by_category ?? {}).map(([key, value]) => ({
    label: CATEGORY_LABEL[key as AttachmentCategory] ?? key,
    value: value ?? 0,
  }));

  return (
    <div className="flex flex-col gap-6 animate-fade-in">
      <div>
        <div className="mb-1.5 text-[11px] font-bold uppercase tracking-wide text-brand-green">
          Module 1 · Document Management
        </div>
        <h1 className="font-display text-2xl font-bold text-ink-900">Attachments</h1>
      </div>

      <div className="grid grid-cols-3 gap-3.5 max-md:grid-cols-1">
        <StatCard icon={Paperclip} value={insights?.total ?? "—"} label="Total documents" />
        <StatCard icon={Star} tone="amber" value={insights?.favourites ?? "—"} label="Favourited" />
        <StatCard
          icon={FileText}
          value={insights?.by_status.ACTIVE ?? "—"}
          label="Active documents"
        />
      </div>

      {categoryChartData.length > 0 && (
        <section className="rounded-lg border border-surface-border bg-surface-card p-[18px] shadow-sm">
          <h2 className="mb-2 font-display text-[15px] font-semibold text-ink-900">
            Documents by category
          </h2>
          <DonutChart data={categoryChartData} centerLabel="Documents" />
        </section>
      )}

      <DocumentLibrary />
    </div>
  );
}
