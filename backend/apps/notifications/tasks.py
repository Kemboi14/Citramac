import structlog
from celery import shared_task
from django.core.mail import send_mail

from apps.tenancy.context import platform_admin_context

logger = structlog.get_logger(__name__)


def _resolve_connection(organization_id):
    """
    Loads the Organization (if any) and delegates to
    apps.notifications.email's org -> platform -> settings.py resolution —
    shared by every task below so each one sends through that tenant's own
    SMTP when it has one configured.
    """
    from apps.notifications.email import get_email_connection_and_sender
    from apps.tenancy.models import Organization

    organization = None
    if organization_id:
        with platform_admin_context():
            organization = Organization.objects.filter(pk=organization_id).first()
    return get_email_connection_and_sender(organization)


@shared_task
def send_otp_sms(phone, code, purpose):
    """
    SMS delivery for login OTPs (docs/14-TENANT-BRANDED-LOGIN-UX.md) when a
    user's preferred_mfa_channel is SMS. Honest stub, same pattern as the
    Sentry-DSN-empty stub in config/settings — no SMS gateway (e.g. Africa's
    Talking) is wired up yet, so this logs a structured, code-free event
    instead of silently pretending delivery happened. Swap the body for a
    real gateway call when one is provisioned; callers (LoginView,
    ResendOtpView) don't need to change either way, since the OTP itself is
    still valid and verifiable via the email channel or the sandbox log in
    dev.
    """
    logger.info("otp_sms_stub_dispatch", phone_last4=phone[-4:] if phone else "", purpose=purpose)


@shared_task
def send_otp_email(email, code, purpose, organization_id=None):
    """
    Dispatches OTP codes for the auth flow (docs/05-AUTHENTICATION-FLOW.md).
    Routes through the caller's own organization's SMTP when configured
    (apps.notifications.email), else the platform default, else the
    settings.py backend — captured by Mailhog in dev
    (docs/12-DEVOPS-DEPLOYMENT.md §12.1). Never logs the code itself outside
    the email body.
    """
    subject_by_purpose = {
        "ACTIVATION": "Your CITRAMAC activation code",
        "LOGIN_2FA": "Your CITRAMAC login code",
        "RESET": "Your CITRAMAC password reset code",
    }
    connection, from_email = _resolve_connection(organization_id)
    send_mail(
        subject=subject_by_purpose.get(purpose, "Your CITRAMAC verification code"),
        message=(
            f"Your verification code is {code}. It expires in 10 minutes and can "
            "only be used once. If you didn't request this, you can ignore this email."
        ),
        from_email=from_email,
        recipient_list=[email],
        connection=connection,
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
    connection, from_email = _resolve_connection(organization_id)
    send_mail(
        subject="URGENT: Risk flag raised on a Mental Status Exam",
        message=(
            f"A Mental Status Exam for {patient_name} (encounter {encounter_id}) flagged "
            "positive suicidal or homicidal ideation. Please review immediately."
        ),
        from_email=from_email,
        recipient_list=supervisor_emails,
        connection=connection,
    )


@shared_task
def send_invite_email(email, organization_name, activation_token, organization_id=None):
    """
    Dispatched when a Super Admin creates an Organization and its Org Admin
    invite — docs/04-MULTI-TENANCY.md §4.5. The activation link is what
    encodes the token Screen A of the auth flow validates against
    (docs/05-AUTHENTICATION-FLOW.md §5.5).
    """
    connection, from_email = _resolve_connection(organization_id)
    send_mail(
        subject=f"You've been invited to CITRAMAC — {organization_name}",
        message=(
            f"You've been invited to set up {organization_name} on CITRAMAC. "
            f"Use this activation code to get started: {activation_token}"
        ),
        from_email=from_email,
        recipient_list=[email],
        connection=connection,
    )
