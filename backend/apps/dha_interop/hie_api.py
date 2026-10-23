"""
Transport for the DHA Health Information Exchange middleware — the one API
that serves the registries, SHA eligibility and benefits, e-claims and
preauthorisation, claim consent, status callbacks and the Shared Health
Record. Every path, parameter and field used here and in the services built
on it comes from the vendored specifications (apps/dha_interop/hie_spec/,
hie_spec/SOURCE.md), never from memory.

Authentication (hie_spec/openapi/auth.openapi.json, POST /tenants/token): a
form-encoded client_id + client_secret returns {access_token, expires_in,
token_type}; the token is sent as a Bearer token and cached until shortly
before it expires. A 401 refreshes it once.

Facility context (guides/authentication__process__facility-identification.md):
CITRAMAC holds one multitenant service account, so every facility-scoped call
carries X-Facility-Id = the branch's SHA FR code and X-Facility-Id-Type =
fr-code (the only supported type). A branch holding its own facility-scoped
credentials (Branch.sha_api_credentials_encrypted, JSON {client_id,
client_secret}) uses those instead and sends no headers — the documentation
discourages sending both.

Failure handling (CLAUDE.md §4 "Fail safely"):
- not configured → HieNotConfigured, logged, never a silent success;
- every call is written to ShaTransactionLog with OTPs, secrets, biometric
  data and file contents redacted;
- errors are the middleware's {error, message, trace_id}; the message and
  trace id reach whoever can act on them;
- a timeout is retried only for reads and for writes the caller marks
  `retry_safe` (a stable business identifier makes a repeat harmless) —
  never blind.
"""

import hashlib
import json
import logging
import time
from dataclasses import dataclass

import requests
from django.conf import settings
from django.core.cache import cache

from apps.tenancy.crypto import decrypt_value

from .models import ShaTransactionLog

logger = logging.getLogger(__name__)

TOKEN_PATH = "/tenants/token"
# Refresh this long before the token's stated expiry.
TOKEN_EARLY_REFRESH_SECONDS = 60
# Request fields never written to the transaction log.
REDACTED_FIELDS = frozenset(
    {
        "otp",
        "client_secret",
        "file_blob",
        "agent_id",
        "work_station_id",
        "match_id",
    }
)
READ_METHODS = ("GET",)


class HieNotConfigured(Exception):
    """No base URL / credentials, or the branch lacks the facility identity a call needs."""


class HieError(Exception):
    """A refused or failed call. `message` is the middleware's own explanation."""

    def __init__(self, message, *, http_status=None, trace_id="", body=None, log=None):
        self.message = message
        self.http_status = http_status
        self.trace_id = trace_id
        self.body = body
        self.log = log
        super().__init__(message)

    @property
    def transient(self):
        return self.http_status is None or self.http_status in (408, 429) or self.http_status >= 500

    def describe(self):
        trace = f" (trace {self.trace_id})" if self.trace_id else ""
        return f"{self.message}{trace}"


@dataclass(frozen=True)
class Credentials:
    base_url: str
    client_id: str
    client_secret: str
    facility_scoped: bool = False

    @property
    def cache_key(self):
        digest = hashlib.sha256(f"{self.base_url}|{self.client_id}".encode()).hexdigest()
        return f"hie-token:{digest}"


def platform_settings():
    from apps.tenancy.models import PlatformHieSettings

    return PlatformHieSettings.get_solo()


def platform_credentials():
    """Super Admin's saved service account, else the HIE_API_* environment values."""
    saved = platform_settings()
    base_url = (saved.base_url or getattr(settings, "HIE_API_BASE_URL", "") or "").rstrip("/")
    client_id = saved.client_id or getattr(settings, "HIE_API_CLIENT_ID", "")
    client_secret = decrypt_value(saved.client_secret_encrypted) or getattr(
        settings, "HIE_API_CLIENT_SECRET", ""
    )
    if not (base_url and client_id and client_secret):
        raise HieNotConfigured(
            "The DHA HIE connection is not configured — a Super Admin enters the base URL, "
            "client ID and client secret under DHA / SHA Integration."
        )
    return Credentials(base_url, client_id, client_secret)


def branch_credentials(branch):
    """(credentials, facility headers) for a call made on behalf of `branch`."""
    own = decrypt_value(branch.sha_api_credentials_encrypted) if branch else ""
    if own:
        try:
            data = json.loads(own)
        except ValueError:
            data = {}
        if data.get("client_id") and data.get("client_secret"):
            base = platform_credentials_base_url()
            return Credentials(base, data["client_id"], data["client_secret"], True), {}
    creds = platform_credentials()
    if branch is None:
        return creds, {}
    if not branch.sha_fr_code:
        raise HieNotConfigured(
            f"{branch.name} has no SHA FR code — an Org Admin adds it in Branch Settings before "
            "the HIE can be called for this facility."
        )
    return creds, {"X-Facility-Id": branch.sha_fr_code, "X-Facility-Id-Type": "fr-code"}


def platform_credentials_base_url():
    saved = platform_settings()
    base_url = (saved.base_url or getattr(settings, "HIE_API_BASE_URL", "") or "").rstrip("/")
    if not base_url:
        raise HieNotConfigured("The DHA HIE base URL is not configured.")
    return base_url


def _timeout():
    return getattr(settings, "HIE_API_TIMEOUT_SECONDS", 30)


def _error_from(response):
    try:
        body = response.json()
    except ValueError:
        body = {"text": response.text[:2000]}
    if isinstance(body, dict):
        message = body.get("message") or body.get("error") or ""
        trace_id = str(body.get("trace_id") or "")
    else:
        message, trace_id = "", ""
    return body, (message or f"HTTP {response.status_code}"), trace_id


def get_token(creds, *, force=False):
    if not force:
        token = cache.get(creds.cache_key)
        if token:
            return token
    try:
        response = requests.post(
            f"{creds.base_url}{TOKEN_PATH}",
            data={"client_id": creds.client_id, "client_secret": creds.client_secret},
            timeout=_timeout(),
        )
    except requests.RequestException as exc:
        raise HieError(f"Could not reach the HIE to sign in: {exc}") from exc
    if not response.ok:
        body, message, trace_id = _error_from(response)
        raise HieError(
            f"The HIE refused the client credentials: {message}",
            http_status=response.status_code,
            trace_id=trace_id,
            body=body,
        )
    body = response.json()
    token = body.get("access_token")
    if not token:
        raise HieError("The HIE token response carried no access_token.", body=body)
    expires_in = int(body.get("expires_in") or 0)
    ttl = max(expires_in - TOKEN_EARLY_REFRESH_SECONDS, 0)
    if ttl:
        cache.set(creds.cache_key, token, ttl)
    return token


def redact(value):
    if isinstance(value, dict):
        return {
            k: ("[redacted]" if k in REDACTED_FIELDS and v not in (None, "") else redact(v))
            for k, v in value.items()
        }
    if isinstance(value, list):
        return [redact(v) for v in value]
    return value


def _log_body(json_body, data, files, params):
    logged = {}
    if params:
        logged["params"] = redact(dict(params))
    if json_body is not None:
        logged["json"] = redact(json_body)
    if data:
        logged["form"] = redact(dict(data))
    if files:
        logged["files"] = sorted(files)
    return logged


def call(
    method,
    path,
    *,
    transaction_type,
    organization_id=None,
    branch=None,
    platform=False,
    params=None,
    json_body=None,
    data=None,
    files=None,
    headers=None,
    retry_safe=False,
    log_response=True,
):
    """
    One HIE request. `branch` scopes it to a facility; `platform=True` makes it
    as the service account with no facility context (registry searches and the
    connection test). Returns the decoded JSON body (or {} for an empty one).
    Raises HieNotConfigured or HieError — the transaction is logged either way.
    """
    log = ShaTransactionLog(
        organization_id=organization_id,
        branch_id=getattr(branch, "id", None),
        transaction_type=transaction_type,
        method=method,
        endpoint=path[:255],
        request_payload=_log_body(json_body, data, files, params),
        status="PENDING",
    )
    try:
        if platform or branch is None:
            creds, facility_headers = platform_credentials(), {}
        else:
            creds, facility_headers = branch_credentials(branch)
    except HieNotConfigured as exc:
        log.status = "FAILED"
        log.error_detail = str(exc)
        log.save()
        raise

    started = time.monotonic()
    attempts = 2 if (method in READ_METHODS or retry_safe) else 1
    refreshed = False
    response = None
    while True:
        try:
            token = get_token(creds, force=refreshed)
        except HieError as exc:
            log.status = "FAILED"
            log.http_status = exc.http_status
            log.trace_id = exc.trace_id
            log.error_detail = exc.message
            log.duration_ms = int((time.monotonic() - started) * 1000)
            log.save()
            exc.log = log
            raise
        request_headers = {"Authorization": f"Bearer {token}", "Accept": "application/json"}
        request_headers.update(facility_headers)
        request_headers.update(headers or {})
        try:
            response = requests.request(
                method,
                f"{creds.base_url}{path}",
                params=params,
                json=json_body,
                data=data,
                files=files,
                headers=request_headers,
                timeout=_timeout(),
            )
        except requests.RequestException as exc:
            attempts -= 1
            log.retry_count += 1
            if attempts > 0:
                continue
            log.status = "FAILED"
            log.error_detail = f"No response from the HIE: {exc}"
            log.duration_ms = int((time.monotonic() - started) * 1000)
            log.save()
            raise HieError(log.error_detail, log=log) from exc
        if response.status_code == 401 and not refreshed:
            refreshed = True
            cache.delete(creds.cache_key)
            continue
        if (response.status_code in (408, 429) or response.status_code >= 500) and attempts > 1:
            attempts -= 1
            log.retry_count += 1
            continue
        break

    log.http_status = response.status_code
    log.duration_ms = int((time.monotonic() - started) * 1000)
    if not response.ok:
        body, message, trace_id = _error_from(response)
        log.status = "FAILED"
        log.trace_id = trace_id
        log.error_detail = message
        log.response_payload = body if isinstance(body, dict) else {"body": body}
        log.save()
        logger.warning(
            "HIE %s %s → %s %s (trace %s)", method, path, response.status_code, message, trace_id
        )
        raise HieError(
            message, http_status=response.status_code, trace_id=trace_id, body=body, log=log
        )
    try:
        body = response.json() if response.content else {}
    except ValueError:
        body = {"text": response.text[:2000]}
    log.status = "SUCCESS"
    if isinstance(body, dict):
        log.trace_id = str(body.get("trace_id") or "")[:64]
    if log_response:
        log.response_payload = body if isinstance(body, dict) else {"items": body}
    else:
        log.response_payload = {"detail": "Response not logged (contains clinical records)."}
    log.save()
    return body


def test_connection():
    """Sign in with the service account. Returns {success, message}."""
    try:
        creds = platform_credentials()
    except HieNotConfigured as exc:
        return {"success": False, "message": str(exc)}
    log = ShaTransactionLog(
        transaction_type="CONNECTION_TEST", method="POST", endpoint=TOKEN_PATH, status="PENDING"
    )
    try:
        get_token(creds, force=True)
    except HieError as exc:
        log.status = "FAILED"
        log.http_status = exc.http_status
        log.trace_id = exc.trace_id
        log.error_detail = exc.message
        log.save()
        return {"success": False, "message": exc.describe()}
    log.status = "SUCCESS"
    log.save()
    return {"success": True, "message": f"Signed in to {creds.base_url}."}
