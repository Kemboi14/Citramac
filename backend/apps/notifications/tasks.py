import structlog
from celery import shared_task

from apps.tenancy.context import platform_admin_context

from .email import send_html_email

logger = structlog.get_logger(__name__)


def _load_organization(organization_id):
    """
    Loads the Organization (if any) under platform_admin_context() — shared
    by every task below so each one resolves that tenant's own configured
    channel (SMTP or SMS gateway) rather than always the platform default.
    """
    from apps.tenancy.models import Organization

    organization = None
    if organization_id:
        with platform_admin_context():
            organization = Organization.objects.filter(pk=organization_id).first()
    return organization


def _resolve_connection(organization_id):
    """
    Delegates to apps.notifications.email's org -> platform -> settings.py
    resolution for the Organization loaded above.
    """
    from apps.notifications.email import get_email_connection_and_sender

    return get_email_connection_and_sender(_load_organization(organization_id))


def create_notification(recipient, category, title, body="", link="", organization_id=None):
    """
    Persists one in-app notification — the topbar bell
    (frontend/src/shells/TopbarActions.tsx) reads these. Runs alongside,
    never instead of, whatever outbound email/SMS a task already sends:
    this is what the recipient sees once they're actually in the app.
    """
    from .models import Notification

    Notification.objects.create(
        recipient=recipient,
        organization_id=organization_id,
        category=category,
        title=title,
        body=body,
        link=link,
    )


@shared_task
def send_otp_sms(phone, code, purpose, organization_id=None):
    """
    SMS delivery for login OTPs (docs/14-TENANT-BRANDED-LOGIN-UX.md) when a
    user's preferred_mfa_channel is SMS. Routes through the caller's own
    organization's Onfon Media gateway when configured
    (apps.notifications.sms), else the platform default, else settings.py's
    ONFON_* env vars, else an honest stub log — never raises, since the OTP
    itself is still valid and verifiable via the email channel or the
    sandbox log in dev even when SMS delivery fails or nothing is
    configured. Never logs the code itself outside the SMS body.
    """
    from apps.notifications.sms import send_sms

    organization = _load_organization(organization_id)
    message = f"Your CITRAMAC verification code is {code}. It expires in 10 minutes."
    send_sms(phone, message, organization=organization)


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
    subject = subject_by_purpose.get(purpose, "Your CITRAMAC verification code")
    send_html_email(
        subject=subject,
        template_name="notifications/emails/otp_email.html",
        context={
            "intro": subject + ":",
            "code": code,
            "expires_minutes": 10,
        },
        plain_message=(
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
        supervisors = list(
            User.objects.filter(
                organization_id=organization_id, roles__name="Supervisor", is_active=True
            )
        )
    if not supervisors:
        return

    for supervisor in supervisors:
        create_notification(
            recipient=supervisor,
            category="RISK_ALERT",
            title="Risk flag raised on a Mental Status Exam",
            body=(
                f"A Mental Status Exam for {patient_name} flagged positive suicidal or "
                "homicidal ideation. Please review immediately."
            ),
            link="/clinical/encounter",
            organization_id=organization_id,
        )

    supervisor_emails = [s.email for s in supervisors]
    connection, from_email = _resolve_connection(organization_id)
    send_html_email(
        subject="URGENT: Risk flag raised on a Mental Status Exam",
        template_name="notifications/emails/risk_alert_email.html",
        context={"patient_name": patient_name, "encounter_id": encounter_id},
        plain_message=(
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
    invite, or invites a platform-staff member directly (organization_name/
    organization_id=None — see apps.accounts.views.PlatformStaffViewSet.create)
    — docs/04-MULTI-TENANCY.md §4.5. The activation link is what encodes the
    token Screen A of the auth flow validates against
    (docs/05-AUTHENTICATION-FLOW.md §5.5) — ActivationPage.tsx reads it from
    the `?token=` query param, with no manual-entry fallback, so the email
    must carry a real clickable link and not just the bare code.
    """
    from django.conf import settings

    connection, from_email = _resolve_connection(organization_id)
    activation_link = f"{settings.FRONTEND_URL}/activate?token={activation_token}"
    if organization_name:
        subject = f"You've been invited to CITRAMAC — {organization_name}"
        plain_message = (
            f"You've been invited to set up {organization_name} on CITRAMAC. "
            f"Activate your account: {activation_link}"
        )
    else:
        subject = "Welcome to CITRAMAC"
        plain_message = (
            "You've been invited to join the CITRAMAC platform team. "
            f"Activate your account: {activation_link}"
        )
    send_html_email(
        subject=subject,
        template_name="notifications/emails/invite_email.html",
        context={
            "organization_name": organization_name,
            "activation_token": activation_token,
            "activation_link": activation_link,
        },
        plain_message=plain_message,
        from_email=from_email,
        recipient_list=[email],
        connection=connection,
    )
