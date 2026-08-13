from celery import shared_task
from django.core.mail import send_mail

from apps.tenancy.context import platform_admin_context


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
def notify_supervisors_of_risk(organization_id, encounter_id, patient_name):
    """
    Positive suicide/homicide-ideation flags escalate to a supervisor alert
    — docs/07-CLINICAL-MODULES-SPEC.md §7.14.2. Runs with platform_admin_context()
    since Celery tasks have no request-bound tenant context of their own
    (see apps.tenancy.context module docstring).
    """
    from apps.accounts.models import User

    with platform_admin_context():
        supervisor_emails = list(
            User.objects.filter(
                organization_id=organization_id, roles__name="Supervisor", is_active=True
            ).values_list("email", flat=True)
        )
    if not supervisor_emails:
        return
    send_mail(
        subject="URGENT: Risk flag raised on a Mental Status Exam",
        message=(
            f"A Mental Status Exam for {patient_name} (encounter {encounter_id}) flagged "
            "positive suicidal or homicidal ideation. Please review immediately."
        ),
        from_email=None,
        recipient_list=supervisor_emails,
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
