"""
Symmetric encryption for at-rest secrets that must never be stored in
plaintext — e.g. Branch.sha_api_credentials_encrypted (docs/04-MULTI-TENANCY.md
§4.5: "DHA/SHA credentials ... stored encrypted"). Uses Fernet (AES-128-CBC +
HMAC, authenticated) keyed from settings.FIELD_ENCRYPTION_KEY.

Deliberately app-layer symmetric encryption rather than a DB-level pgcrypto
column: it keeps the key out of the database entirely (a stolen DB dump alone
can't decrypt), matching the same "defense in depth" posture as the RLS
policies in apps/tenancy/rls.py.
"""

from cryptography.fernet import Fernet, InvalidToken
from django.conf import settings


def _fernet():
    return Fernet(settings.FIELD_ENCRYPTION_KEY)


def encrypt_value(plaintext: str) -> str:
    if not plaintext:
        return ""
    return _fernet().encrypt(plaintext.encode("utf-8")).decode("ascii")


def decrypt_value(ciphertext: str) -> str:
    if not ciphertext:
        return ""
    try:
        return _fernet().decrypt(ciphertext.encode("ascii")).decode("utf-8")
    except InvalidToken:
        return ""
