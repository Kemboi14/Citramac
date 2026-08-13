from celery import shared_task
from django.core.mail import send_mail


@shared_task
def send_otp_email(email, code, purpose):
    """
    Dispatches OTP codes for the auth flow (docs/05-AUTHENTICATION-FLOW.md).
    Captured by Mailhog in dev (docs/12-DEVOPS-DEPLOYMENT.md §12.1) — never
    logs the code itself outside the email body.
    """
    subject_by_purpose = {
        "ACTIVATION": "Your CITRAMAC activation code",
        "LOGIN_2FA": "Your CITRAMAC login code",
        "RESET": "Your CITRAMAC password reset code",
    }
    send_mail(
        subject=subject_by_purpose.get(purpose, "Your CITRAMAC verification code"),
        message=(
            f"Your verification code is {code}. It expires in 10 minutes and can "
            "only be used once. If you didn't request this, you can ignore this email."
        ),
        from_email=None,
        recipient_list=[email],
    )


@shared_task
def send_invite_email(email, organization_name, activation_token):
    """
    Dispatched when a Super Admin creates an Organization and its Org Admin
    invite — docs/04-MULTI-TENANCY.md §4.5. The activation link is what
    encodes the token Screen A of the auth flow validates against
    (docs/05-AUTHENTICATION-FLOW.md §5.5).
    """
    send_mail(
        subject=f"You've been invited to CITRAMAC — {organization_name}",
        message=(
            f"You've been invited to set up {organization_name} on CITRAMAC. "
            f"Use this activation code to get started: {activation_token}"
        ),
        from_email=None,
        recipient_list=[email],
    )
