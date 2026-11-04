import { ArrowRight, FileText, ListChecks } from "lucide-react";
import { Link } from "react-router-dom";
import { PageHeader } from "./shared/ui";

const REFERRAL_LINK =
  "group flex items-center justify-between gap-4 rounded-lg border border-surface-border bg-surface-card p-5 text-ink-900 shadow-sm transition-colors hover:border-brand-green/50 hover:bg-surface-bg focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-green";
const REFERRAL_BUTTON =
  "mt-4 inline-flex items-center gap-2 rounded-[9px] border border-brand-green bg-brand-green px-4 py-2 text-[13px] font-semibold text-on-primary transition-colors duration-150 group-hover:border-brand-green-dark group-hover:bg-brand-green-dark";

export function ReferralsPage() {
  return (
    <div className="animate-fade-in">
      <PageHeader
        title="Referrals"
        subtitle="Choose a referral worklist or open referral documents."
      />
      <div className="grid gap-4 sm:grid-cols-2">
        <Link to="/clinical/referrals/worklist" className={REFERRAL_LINK}>
          <div>
            <ListChecks className="h-6 w-6 text-brand-green" aria-hidden="true" />
            <h2 className="mt-3 font-display text-lg font-semibold">Referral worklist</h2>
            <p className="mt-1 text-[13px] text-ink-500">
              Review and manage referrals requiring attention.
            </p>
            <span className={REFERRAL_BUTTON}>
              Open worklist <ArrowRight className="h-4 w-4" aria-hidden="true" />
            </span>
          </div>
        </Link>
        <Link to="/clinical/referrals/documents" className={REFERRAL_LINK}>
          <div>
            <FileText className="h-6 w-6 text-brand-green" aria-hidden="true" />
            <h2 className="mt-3 font-display text-lg font-semibold">Referral documents</h2>
            <p className="mt-1 text-[13px] text-ink-500">
              View and prepare documents related to client referrals.
            </p>
            <span className={REFERRAL_BUTTON}>
              Open documents <ArrowRight className="h-4 w-4" aria-hidden="true" />
            </span>
          </div>
        </Link>
      </div>
    </div>
  );
}
