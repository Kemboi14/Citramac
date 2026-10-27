"""
Per-organization SMTP resolution — the "each tenant configures their own
email" self-service feature. Resolution order: the Organization's own
email_* fields, then PlatformEmailSettings (Super Admin's platform-wide
fallback), then Django's globally configured EMAIL_BACKEND (settings.py env
vars, or the honest console fallback in config/settings/production.py when
none are set) — so an org/platform that hasn't configured anything here
keeps sending exactly as it did before this feature existed.

An org's own settings are also never the only route: if its SMTP server (or
its From: address) is refused, the message is re-sent through the platform
SMTP with the platform's From: address, and the failure is logged so the org
can fix its settings — see OrganizationEmailBackend.
"""

import structlog
from django.conf import settings
from django.core.mail import EmailMultiAlternatives, get_connection
from django.core.mail.backends.smtp import EmailBackend as SMTPEmailBackend
from django.template.loader import render_to_string

from apps.tenancy.crypto import decrypt_value

logger = structlog.get_logger(__name__)

SMTP_BACKEND = "django.core.mail.backends.smtp.EmailBackend"


class OrganizationEmailBackend(SMTPEmailBackend):
    """
    SMTP backend for an org's own email settings that falls back to the
    platform when they fail — a wrong host, a rejected password or an
    invalid From: address otherwise means login OTPs silently never arrive.
    OSError covers every smtplib, socket and TLS failure. Callers send one
    message per connection, so a retry can't duplicate an earlier send.
    """

    def __init__(self, *, fallback_connection, fallback_from_email, organization_id, **kwargs):
        super().__init__(**kwargs)
        self.fallback_connection = fallback_connection
        self.fallback_from_email = fallback_from_email
        self.organization_id = organization_id

    def send_messages(self, email_messages):
        try:
            return super().send_messages(email_messages)
        except OSError as exc:
            if self.fallback_connection is None:
                raise
            logger.warning(
                "organization_email_failed_sent_via_platform",
                organization_id=str(self.organization_id),
                smtp_host=self.host,
                error_type=type(exc).__name__,
                error=str(exc)[:300],
            )
            for message in email_messages:
                message.from_email = self.fallback_from_email
                message.connection = self.fallback_connection
            return self.fallback_connection.send_messages(email_messages)


def send_html_email(
    subject, template_name, context, plain_message, from_email, recipient_list, connection
):
    """Shared HTML+plaintext sender — every notification task in the project builds
    its message with this so the multipart/alternative structure and the
    `{subject}` template context var stay consistent."""
    email = EmailMultiAlternatives(
        subject=subject,
        body=plain_message,
        from_email=from_email,
        to=recipient_list,
        connection=connection,
    )
    email.attach_alternative(
        render_to_string(template_name, {**context, "subject": subject}), "text/html"
    )
    email.send()


def _smtp_kwargs(host, port, username, password_encrypted, use_tls, use_ssl):
    if not host:
        return None
    return {
        "host": host,
        "port": port or 587,
        "username": username,
        "password": decrypt_value(password_encrypted) if password_encrypted else "",
        "use_tls": use_tls,
        "use_ssl": use_ssl,
    }


def get_email_connection_and_sender(organization=None):
    """
    Returns (connection, from_email). `connection=None` means "let send_mail
    use Django's default backend" — the pre-existing, single-tenant behavior.

    The From: address and the SMTP server that relays it are resolved
    independently: an org can set its own display From: address
    (email_from_address) while still relaying through the platform's SMTP,
    or take over the connection too by also setting email_host — same
    "opt into as much as you configure" fallback as the connection itself.
    Whenever the org has set either, the connection is an
    OrganizationEmailBackend that falls back to the platform on failure.
    """
    from apps.tenancy.models import PlatformEmailSettings

    platform_settings = PlatformEmailSettings.get_solo()
    platform_from_email = platform_settings.default_from_email or settings.DEFAULT_FROM_EMAIL
    platform_kwargs = _smtp_kwargs(
        platform_settings.host,
        platform_settings.port,
        platform_settings.host_user,
        platform_settings.host_password_encrypted,
        platform_settings.use_tls,
        platform_settings.use_ssl,
    )

    org_kwargs = None
    org_from_email = ""
    if organization is not None:
        org_kwargs = _smtp_kwargs(
            organization.email_host,
            organization.email_port,
            organization.email_host_user,
            organization.email_host_password_encrypted,
            organization.email_use_tls,
            organization.email_use_ssl,
        )
        org_from_email = organization.email_from_address

    if platform_kwargs is not None:
        fallback_connection = get_connection(backend=SMTP_BACKEND, **platform_kwargs)
    elif settings.EMAIL_BACKEND.endswith("console.EmailBackend"):
        # production.py's no-SMTP stub only prints mail — not a delivery
        # route, so an org failure is raised rather than "sent" there.
        fallback_connection = None
    else:
        fallback_connection = get_connection()

    primary_kwargs = org_kwargs or (platform_kwargs if org_from_email else None)
    if primary_kwargs is not None:
        connection = OrganizationEmailBackend(
            fallback_connection=fallback_connection,
            fallback_from_email=platform_from_email,
            organization_id=organization.pk,
            **primary_kwargs,
        )
    elif platform_kwargs is not None:
        connection = fallback_connection
    else:
        connection = None

    return connection, org_from_email or platform_from_email
