from django.urls import path

from . import auth_views

urlpatterns = [
    path("identify/", auth_views.IdentifyView.as_view(), name="auth-identify"),
    path("confirm-email/", auth_views.ConfirmEmailView.as_view(), name="auth-confirm-email"),
    path("verify-otp/", auth_views.VerifyOtpView.as_view(), name="auth-verify-otp"),
    path("resend-otp/", auth_views.ResendOtpView.as_view(), name="auth-resend-otp"),
    path("set-password/", auth_views.SetPasswordView.as_view(), name="auth-set-password"),
    path("login/", auth_views.LoginView.as_view(), name="auth-login"),
    path(
        "login/verify-otp/", auth_views.LoginVerifyOtpView.as_view(), name="auth-login-verify-otp"
    ),
    path("refresh/", auth_views.RefreshView.as_view(), name="auth-refresh"),
    path("logout/", auth_views.LogoutView.as_view(), name="auth-logout"),
    path("forgot-password/", auth_views.ForgotPasswordView.as_view(), name="auth-forgot-password"),
]
