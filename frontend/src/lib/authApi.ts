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

export function resendOtp(otpToken: string) {
  return apiRequest<{ otp_token: string }>("/auth/resend-otp/", {
    method: "POST",
    body: { otp_token: otpToken },
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

export type LoginResult = { access: string } | { requires_otp: true; otp_token: string };

export function login(email: string, password: string) {
  return apiRequest<LoginResult>("/auth/login/", {
    method: "POST",
    body: { email, password },
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
