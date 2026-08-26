import { apiRequest } from "./apiClient";

// Mirrors apps.security's serializers/views — citramac_SUPER-ADMIN.html
// "Security Dashboard" / "Security Policies" / "Tenant Security" /
// "Security Alerts". Every number here is computed live from real
// AuditLogEntry/User data server-side, not fixture/demo rows.

export interface MandatoryControls {
  tenant_isolation: boolean;
  rbac_enforcement: boolean;
  audit_logging: boolean;
  api_authentication: boolean;
  encryption_in_transit: boolean;
  encryption_at_rest: boolean;
  mfa_required: boolean;
}

export interface SecurityPolicy {
  minimum_password_length: number;
  password_complexity: string;
  password_expiry_days: number;
  password_history_count: number;
  max_failed_login_attempts: number;
  lockout_duration_minutes: number;
  session_timeout_minutes: number;
  max_concurrent_sessions: number;
  token_expiry_minutes: number;
  rate_limit_per_minute: number;
  data_retention_years: number;
  updated_at: string;
  mandatory_controls: MandatoryControls;
}

export function getSecurityPolicy(accessToken: string) {
  return apiRequest<SecurityPolicy>("/security/policy/", { accessToken });
}

export function updateSecurityPolicy(accessToken: string, payload: Partial<SecurityPolicy>) {
  return apiRequest<SecurityPolicy>("/security/policy/", {
    method: "PATCH",
    body: payload,
    accessToken,
  });
}

export type TenantSecurityStatus = "Secure" | "Warning" | "Non-Compliant" | "Critical";

export interface TenantSecurityRow {
  organization_id: string;
  organization_name: string;
  organization_slug: string;
  score: number;
  status: TenantSecurityStatus;
  mfa_adoption_percent: number;
  mfa_enabled_count: number;
  total_users: number;
  failed_logins_24h: number;
  password_policy: string;
  session_security: string;
  audit_logging: string;
  api_security: string;
}

export interface SecurityDashboard {
  total_tenants: number;
  fully_compliant_tenants: number;
  tenants_with_warnings: number;
  non_compliant_tenants: number;
  critical_security_issues: number;
  mfa_adoption_percent: number;
  active_alerts: number;
  failed_logins_24h: number;
  tenants: TenantSecurityRow[];
}

export function getSecurityDashboard(accessToken: string) {
  return apiRequest<SecurityDashboard>("/security/dashboard/", { accessToken });
}

export type SecurityAlertStatus = "NEW" | "INVESTIGATING" | "RESOLVED" | "DISMISSED";
export type SecurityAlertSeverity = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";

export interface SecurityAlert {
  id: string;
  organization_id: string | null;
  organization_name: string;
  category: "FAILED_LOGINS" | "MFA_ADOPTION";
  severity: SecurityAlertSeverity;
  description: string;
  status: SecurityAlertStatus;
  detected_at: string;
  updated_at: string;
  resolved_at: string | null;
}

export function listSecurityAlerts(accessToken: string) {
  return apiRequest<{ count: number; results: SecurityAlert[] }>("/security/alerts/", {
    accessToken,
  });
}

export function investigateAlert(accessToken: string, id: string) {
  return apiRequest<SecurityAlert>(`/security/alerts/${id}/investigate/`, {
    method: "POST",
    accessToken,
  });
}

export function resolveAlert(accessToken: string, id: string) {
  return apiRequest<SecurityAlert>(`/security/alerts/${id}/resolve/`, {
    method: "POST",
    accessToken,
  });
}

export function dismissAlert(accessToken: string, id: string) {
  return apiRequest<SecurityAlert>(`/security/alerts/${id}/dismiss/`, {
    method: "POST",
    accessToken,
  });
}
