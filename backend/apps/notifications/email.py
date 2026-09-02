"""
Per-organization SMTP resolution — the "each tenant configures their own
email" self-service feature. Resolution order: the Organization's own
email_* fields, then PlatformEmailSettings (Super Admin's platform-wide
fallback), then Django's globally configured EMAIL_BACKEND (settings.py env
vars, or the honest console fallback in config/settings/production.py when
none are set) — so an org/platform that hasn't configured anything here
keeps sending exactly as it did before this feature existed.
"""

from django.conf import settings
from django.core.mail import get_connection

from apps.tenancy.crypto import decrypt_value

SMTP_BACKEND = "django.core.mail.backends.smtp.EmailBackend"


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
    """
    from apps.tenancy.models import PlatformEmailSettings

    platform_settings = PlatformEmailSettings.get_solo()

    org_kwargs = None
    if organization is not None:
        org_kwargs = _smtp_kwargs(
            organization.email_host,
            organization.email_port,
            organization.email_host_user,
            organization.email_host_password_encrypted,
            organization.email_use_tls,
            organization.email_use_ssl,
        )

    if org_kwargs is not None:
        connection = get_connection(backend=SMTP_BACKEND, **org_kwargs)
    else:
        platform_kwargs = _smtp_kwargs(
            platform_settings.host,
            platform_settings.port,
            platform_settings.host_user,
            platform_settings.host_password_encrypted,
            platform_settings.use_tls,
            platform_settings.use_ssl,
        )
        connection = (
            get_connection(backend=SMTP_BACKEND, **platform_kwargs) if platform_kwargs else None
        )

    from_email = (
        (organization.email_from_address if organization is not None else "")
        or platform_settings.default_from_email
        or settings.DEFAULT_FROM_EMAIL
    )
    return connection, from_email
