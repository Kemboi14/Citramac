import { apiRequest } from "./apiClient";

// Request/response shapes mirror apps/accounts/serializers.py and
// apps/accounts/auth_views.py exactly — see docs/05-AUTHENTICATION-FLOW.md §5.6.

export function identify(activationToken: string, name: string) {
  return apiRequest<{ masked_email: string }>("/auth/identify/", {
    method: "POST",
    body: { activation_token: activationToken, name },
  });
}

export function confirmEmail(activationToken: string, email: string) {
  return apiRequest<{ otp_token: string }>("/auth/confirm-email/", {
    method: "POST",
    body: { activation_token: activationToken, email },
  });
}

/** "EMAIL" | "SMS" — see apps.accounts.models.User.MFA_CHANNEL_CHOICES. */
export type MfaChannel = "EMAIL" | "SMS";

export interface MfaDeliveryMethod {
  channel: MfaChannel;
  masked_contact: string;
}

export function resendOtp(otpToken: string, channel?: MfaChannel) {
  return apiRequest<{ otp_token: string; channel?: MfaChannel }>("/auth/resend-otp/", {
    method: "POST",
    body: channel ? { otp_token: otpToken, channel } : { otp_token: otpToken },
  });
}

export function verifyOtp(otpToken: string, otp: string) {
  return apiRequest<{ password_setup_token: string }>("/auth/verify-otp/", {
    method: "POST",
    body: { otp_token: otpToken, otp },
  });
}

export function setPassword(passwordSetupToken: string, password: string) {
  return apiRequest<Record<string, never>>("/auth/set-password/", {
    method: "POST",
    body: { password_setup_token: passwordSetupToken, password },
  });
}

/** Tenant branding surfaced by /auth/tenant-discovery/ — docs/14-TENANT-BRANDED-LOGIN-UX.md. */
export interface TenantBranding {
  id: string;
  name: string;
  logo_url: string;
  login_image_url: string;
  tagline: string;
  primary_color: string;
  support_email: string;
  support_phone: string;
  website: string;
}

export function tenantDiscovery(email: string) {
  return apiRequest<{ tenant: TenantBranding }>("/auth/tenant-discovery/", {
    method: "POST",
    body: { email },
  });
}

export type LoginResult =
  | { access: string }
  | {
      requires_otp: true;
      otp_token: string;
      channel: MfaChannel;
      delivery_methods: MfaDeliveryMethod[];
    };

export function login(email: string, password: string, remember = false) {
  return apiRequest<LoginResult>("/auth/login/", {
    method: "POST",
    body: { email, password, remember },
  });
}

export function loginVerifyOtp(otpToken: string, otp: string) {
  return apiRequest<{ access: string }>("/auth/login/verify-otp/", {
    method: "POST",
    body: { otp_token: otpToken, otp },
  });
}

export function refresh() {
  return apiRequest<{ access: string }>("/auth/refresh/", { method: "POST", body: {} });
}

export function logout(accessToken: string) {
  return apiRequest<void>("/auth/logout/", { method: "POST", body: {}, accessToken });
}

export function forgotPassword(email: string) {
  return apiRequest<{ otp_token: string }>("/auth/forgot-password/", {
    method: "POST",
    body: { email },
  });
}
