"""
Payload signing for SHA pre-auth/e-claims submissions — docs/08-DHA-SHA-INTEGRATION.md
§8.4: "Facilities hold a digital certificate ... used to sign pre-auth and
e-claims payloads (e.g., JWS/detached signature over the JSON body). Store
private keys in a secrets manager / HSM-backed KMS — never in the
application database or source control."

No HSM/KMS integration exists in this environment; `SHA_GATEWAY_SIGNING_KEY_PATH`
points at a local PEM private key file for sandbox use only. Production
deployments must replace `_load_private_key` with an HSM/KMS-backed signer
before going live — this is called out explicitly rather than silently
using a weaker substitute.
"""

import base64
import json

from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import padding, rsa
from django.conf import settings


class SigningNotConfigured(Exception):
    pass


def _b64url(raw_bytes):
    return base64.urlsafe_b64encode(raw_bytes).rstrip(b"=").decode("ascii")


def _load_private_key():
    key_path = getattr(settings, "SHA_GATEWAY_SIGNING_KEY_PATH", "") or ""
    if not key_path:
        raise SigningNotConfigured(
            "settings.SHA_GATEWAY_SIGNING_KEY_PATH is not configured — no facility signing "
            "key available. Production requires an HSM/KMS-backed key per §8.4, not a local "
            "PEM file; wire that in before enabling SHA_GATEWAY_MODE=production."
        )
    with open(key_path, "rb") as key_file:
        return serialization.load_pem_private_key(key_file.read(), password=None)


def sign_payload(payload_dict):
    """
    Produces a detached JWS (RS256) over the canonical JSON payload: the
    signature covers `header.payload` but only `header..signature` is
    returned, per JWS Detached Content (RFC 7515 §4). Callers transmit the
    JSON body and this signature string separately (e.g. an
    `X-Citramac-Signature` header), so raises SigningNotConfigured rather
    than silently sending an unsigned payload.
    """
    private_key = _load_private_key()
    if not isinstance(private_key, rsa.RSAPrivateKey):
        raise SigningNotConfigured("Configured signing key is not an RSA private key.")

    header = _b64url(json.dumps({"alg": "RS256", "typ": "JWS"}).encode("utf-8"))
    payload = _b64url(json.dumps(payload_dict, sort_keys=True, default=str).encode("utf-8"))
    signing_input = f"{header}.{payload}".encode("ascii")

    signature = private_key.sign(signing_input, padding.PKCS1v15(), hashes.SHA256())
    return f"{header}..{_b64url(signature)}"
