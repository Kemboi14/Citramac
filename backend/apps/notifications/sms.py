"""
Per-organization SMS gateway resolution and dispatch — the SMS equivalent of
apps.notifications.email's "each tenant configures their own" feature.
Resolution order: the Organization's own sms_* fields, then
PlatformSmsSettings (Super Admin's platform-wide fallback), then
settings.py's ONFON_* env vars — so an org/platform that hasn't configured
anything here falls all the way through to an honest stub log instead of
silently pretending delivery happened (same posture as the pre-existing
send_otp_sms stub this module replaces the body of).

Onfon Media (https://www.docs.onfonmedia.co.ke/rest/sms/) is the only
gateway wired up today. Organization.sms_provider/PlatformSmsSettings.provider
exist so a second gateway can be added later (branch on `provider` in
send_sms) without another migration.
"""

import requests
import structlog
from django.conf import settings

from apps.tenancy.crypto import decrypt_value

logger = structlog.get_logger(__name__)

ONFON_SEND_URL = "https://api.onfonmedia.co.ke/v1/sms/SendBulkSMS"
REQUEST_TIMEOUT_SECONDS = 10


def normalize_msisdn(phone):
    """
    Onfon expects a bare MSISDN like '2547XXXXXXXX' — no leading '+' or
    '0'. Numbers in this system are free-text CharFields (User.phone,
    Patient.contact_phone) entered as '07XXXXXXXX', '+2547XXXXXXXX' or
    '2547XXXXXXXX' interchangeably, so callers don't have to normalize
    before calling send_sms.
    """
    digits = "".join(ch for ch in (phone or "") if ch.isdigit())
    if digits.startswith("0"):
        return "254" + digits[1:]
    if digits.startswith("254"):
        return digits
    if digits.startswith("7") or digits.startswith("1"):
        return "254" + digits
    return digits


def _onfon_credentials(sender_id, client_id, access_key, api_key):
    """None unless every credential Onfon requires is present — a sender ID
    alone (no keys), or keys with no sender ID, is exactly as "not
    configured" as nothing at all."""
    if not (sender_id and client_id and access_key and api_key):
        return None
    return {
        "sender_id": sender_id,
        "client_id": client_id,
        "access_key": access_key,
        "api_key": api_key,
    }


def get_sms_credentials(organization=None):
    """
    Returns an Onfon credential dict, or None when neither the
    organization, nor the platform-wide fallback (PlatformSmsSettings), nor
    settings.py's ONFON_* env vars have a complete set of credentials
    configured. Same org -> platform -> settings.py resolution order as
    apps.notifications.email.get_email_connection_and_sender.
    """
    from apps.tenancy.models import PlatformSmsSettings

    if organization is not None:
        org_credentials = _onfon_credentials(
            organization.sms_sender_id,
            organization.sms_client_id,
            decrypt_value(organization.sms_access_key_encrypted),
            decrypt_value(organization.sms_api_key_encrypted),
        )
        if org_credentials is not None:
            return org_credentials

    platform_settings = PlatformSmsSettings.get_solo()
    platform_credentials = _onfon_credentials(
        platform_settings.sender_id,
        platform_settings.client_id,
        decrypt_value(platform_settings.access_key_encrypted),
        decrypt_value(platform_settings.api_key_encrypted),
    )
    if platform_credentials is not None:
        return platform_credentials

    return _onfon_credentials(
        settings.ONFON_SENDER_ID,
        settings.ONFON_CLIENT_ID,
        settings.ONFON_ACCESS_KEY,
        settings.ONFON_API_KEY,
    )


def send_sms(phone, message, organization=None):
    """
    Sends one SMS via Onfon Media's SendBulkSMS API. Resolves credentials
    with get_sms_credentials() first — if nothing is configured anywhere,
    logs a structured, code-free stub event (same honest-stub posture the
    OTP-over-SMS task had before any gateway was wired up) and returns
    False rather than raising, since callers (OTP dispatch, appointment
    reminders) always have another channel or can simply skip a reminder.

    Returns True once Onfon accepts the message (ErrorCode 0), False on any
    failure (not configured, network error, or Onfon rejecting the send).
    """
    phone_last4 = phone[-4:] if phone else ""
    credentials = get_sms_credentials(organization)
    if credentials is None:
        logger.info("sms_stub_dispatch", phone_last4=phone_last4)
        return False

    to = normalize_msisdn(phone)
    payload = {
        "SenderId": credentials["sender_id"],
        "IsUnicode": False,
        "IsFlash": False,
        "MessageParameters": [{"Number": to, "Text": message}],
        "ApiKey": credentials["api_key"],
        "ClientId": credentials["client_id"],
    }
    headers = {
        "Content-Type": "application/json",
        "AccessKey": credentials["access_key"],
    }

    try:
        response = requests.post(
            ONFON_SEND_URL, json=payload, headers=headers, timeout=REQUEST_TIMEOUT_SECONDS
        )
        response.raise_for_status()
        data = response.json()
    except (requests.RequestException, ValueError) as exc:
        logger.error("sms_send_failed", error=str(exc), phone_last4=phone_last4)
        return False

    error_code = data.get("ErrorCode")
    if error_code not in (0, "0"):
        logger.error(
            "sms_send_rejected",
            error_code=error_code,
            error_description=data.get("ErrorDescription"),
            phone_last4=phone_last4,
        )
        return False

    logger.info("sms_sent", phone_last4=phone_last4)
    return True
