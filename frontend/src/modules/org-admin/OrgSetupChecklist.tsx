import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ListChecks } from "lucide-react";
import { useAuth } from "../../auth/useAuth";
import { apiRequest } from "../../lib/apiClient";
import { StatusPill } from "../care/shared/ui";

// Mirrors apps.tenancy.setup_checklist.checklist.
interface ChecklistItem {
  key: string;
  label: string;
  detail: string;
  done: boolean;
  required: boolean;
  link: string;
  count?: number;
}

function getSetupChecklist(accessToken: string, organizationId: string) {
  return apiRequest<{ items: ChecklistItem[] }>(
    `/platform/organizations/${organizationId}/setup-checklist/`,
    { accessToken },
  );
}

/**
 * "Organisation setup" on the Org Admin dashboard — what the Org Admin still
 * has to fill in (NACADA reporting email, branch registration and licence,
 * their own profile) and the staff profiles waiting on them. Each row links to
 * the page that fixes it. Hidden once everything is done.
 */
export function OrgSetupChecklist() {
  const { accessToken, claims } = useAuth();
  const organizationId = claims?.organization_id ?? null;
  const [items, setItems] = useState<ChecklistItem[] | null>(null);

  useEffect(() => {
    if (!accessToken || !organizationId) return;
    getSetupChecklist(accessToken, organizationId)
      .then((res) => setItems(res.items))
      .catch(() => setItems(null));
  }, [accessToken, organizationId]);

  if (!items || items.every((i) => i.done)) return null;
  const outstanding = items.filter((i) => !i.done).length;

  return (
    <div className="rounded-lg border border-surface-border bg-surface-card p-6 shadow-sm">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="inline-flex items-center gap-2 font-display text-base font-semibold text-ink-900">
          <ListChecks size={16} className="text-brand-green" />
          Organisation setup
        </h2>
        <StatusPill tone="warning">{outstanding} to do</StatusPill>
      </div>
      <ul>
        {items.map((item) => (
          <li
            key={item.key}
            className="flex flex-wrap items-center gap-3 border-b border-surface-border py-2.5 last:border-b-0"
          >
            <div className="min-w-0 flex-1">
              <div className="text-[13px] font-semibold text-ink-900">
                {item.label}
                {!item.required && (
                  <span className="ml-1.5 text-[11.5px] font-normal text-ink-500">
                    (recommended)
                  </span>
                )}
              </div>
              <div className="text-[12.5px] text-ink-500">{item.detail}</div>
            </div>
            <StatusPill tone={item.done ? "success" : item.required ? "warning" : "neutral"}>
              {item.done ? "Done" : "To do"}
            </StatusPill>
            {!item.done && (
              <Link
                to={item.link}
                className="text-[12.5px] font-semibold text-brand-green-dark hover:underline"
              >
                Open
              </Link>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
