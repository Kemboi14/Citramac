import { apiRequest } from "./apiClient";

// Mirrors apps.sysadmin_audit's AuditLogListView — docs/09-SECURITY-COMPLIANCE.md
// §9.4. citramac_SUPER-ADMIN.html "Audit Log" + "Security Audit Logs".

export type AuditAction =
  "CREATE" | "UPDATE" | "DELETE" | "VIEW" | "ERASURE" | "LOGIN" | "LOGIN_FAILED" | "LOGOUT";

export interface AuditLogEntry {
  id: string;
  organization_id: string | null;
  organization_name: string;
  branch_id: string | null;
  actor_user_id: string | null;
  actor_name: string;
  actor_role: string;
  action: AuditAction;
  model: string;
  object_id: string;
  field_diff: Record<string, { old: unknown; new: unknown }>;
  timestamp: string;
  source_ip: string | null;
  request_id: string;
}

export interface AuditLogPage {
  count: number;
  page: number;
  page_size: number;
  results: AuditLogEntry[];
}

export interface AuditLogParams {
  category?: "security";
  action?: AuditAction;
  model?: string;
  q?: string;
  page?: number;
}

export function listAuditLog(accessToken: string, params: AuditLogParams = {}) {
  const query = new URLSearchParams(
    Object.entries(params).filter(([, v]) => Boolean(v)) as [string, string][],
  ).toString();
  return apiRequest<AuditLogPage>(`/audit-log/${query ? `?${query}` : ""}`, { accessToken });
}
