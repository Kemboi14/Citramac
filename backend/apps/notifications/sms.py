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


def _post_to_onfon(credentials, phone, message):
    """
    The actual Onfon SendBulkSMS HTTP call, factored out of send_sms so the
    "Test connection" button (test_sms_connection, below) can reuse it and
    get back *why* a send failed instead of a bare boolean — a masked
    True/False on a credentials-test screen tells an admin nothing about
    whether the Sender ID, Client ID, Access Key or API Key is the one
    that's wrong.

    Returns (ok, detail) — detail is a JSON-safe dict describing the
    outcome, shaped differently per failure reason but always carrying
    enough to log or show to an admin.
    """
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
    except requests.RequestException as exc:
        return False, {"reason": "network_error", "detail": str(exc)}

    try:
        data = response.json()
    except ValueError:
        return False, {
            "reason": "invalid_response",
            "status_code": response.status_code,
            "detail": response.text[:500],
        }

    error_code = data.get("ErrorCode")
    if error_code not in (0, "0"):
        return False, {
            "reason": "rejected",
            "error_code": error_code,
            "error_description": data.get("ErrorDescription"),
            "status_code": response.status_code,
        }

    if not response.ok:
        return False, {"reason": "http_error", "status_code": response.status_code}

    return True, {"error_code": error_code, "status_code": response.status_code}


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

    ok, detail = _post_to_onfon(credentials, phone, message)
    if not ok:
        if detail["reason"] in ("network_error", "invalid_response"):
            logger.error("sms_send_failed", error=detail.get("detail"), phone_last4=phone_last4)
        else:
            logger.error(
                "sms_send_rejected",
                error_code=detail.get("error_code"),
                error_description=detail.get("error_description"),
                phone_last4=phone_last4,
            )
        return False

    logger.info("sms_sent", phone_last4=phone_last4)
    return True


def resolve_credentials_with_overrides(sender_id, client_id, access_key, api_key, overrides):
    """
    Merges a saved (already-decrypted) credential set with any non-blank
    values from a request body — lets the SMS settings screen's "Test
    connection" button test values an admin just typed but hasn't saved
    yet, falling back to the stored value for anything left blank. Same
    "blank means keep the current one" semantics as the settings PATCH
    endpoints. Returns None if the merged set is still incomplete.
    """

    def pick(saved, key):
        value = overrides.get(key)
        return value if value else saved

    return _onfon_credentials(
        pick(sender_id, "sender_id"),
        pick(client_id, "client_id"),
        pick(access_key, "access_key"),
        pick(api_key, "api_key"),
    )


def test_sms_connection(credentials, phone):
    """
    Sends a real, one-off test SMS via Onfon using the given credentials —
    backs the SMS settings screen's "Test connection" button so an admin can
    confirm Onfon is reachable (and which credential is wrong, if not)
    before relying on it for OTP delivery. Returns a JSON-safe dict with a
    human-readable `message` describing exactly what Onfon said.
    """
    ok, detail = _post_to_onfon(credentials, phone, "Citramac SMS gateway test message.")
    if ok:
        return {"success": True, "message": "Onfon accepted the test message."}

    reason = detail.get("reason")
    if reason == "network_error":
        return {"success": False, "message": f"Could not reach Onfon: {detail.get('detail')}"}
    if reason == "invalid_response":
        return {
            "success": False,
            "message": f"Onfon returned an unexpected response (HTTP {detail.get('status_code')}).",
        }
    if reason == "rejected":
        description = detail.get("error_description") or "no description given"
        return {
            "success": False,
            "message": (
                f"Onfon rejected the message — ErrorCode {detail.get('error_code')}: {description}."
            ),
        }
    return {
        "success": False,
        "message": f"Onfon returned HTTP {detail.get('status_code')}.",
    }
