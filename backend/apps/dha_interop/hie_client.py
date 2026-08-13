"""
HIE (National Health Information Exchange) transmission — docs/08-DHA-SHA-INTEGRATION.md
§8.1: "transmits it to the National Health Information Exchange (HIE)
endpoint over mutual-TLS." No real HIE endpoint/mTLS certificate is
configured in this environment (`settings.HIE_ENDPOINT_URL` is empty by
default) — this honestly caches the Bundle and reports a skipped
transmission rather than faking a successful send, consistent with the
sha_gateway.py stub pattern from Phase 4.
"""

import requests
from django.conf import settings

from .models import FhirResourceCache


def transmit_referral(referral_packet, bundle_json):
    """
    Caches the outbound Bundle (offline resilience + audit, §8.1) and
    attempts a real POST only if an HIE endpoint is configured. Returns the
    FhirResourceCache row so callers can inspect status/transmission_detail.
    """
    cache_entry = FhirResourceCache.objects.create(
        organization_id=referral_packet.organization_id,
        resource_type="Bundle",
        direction="OUTBOUND",
        fhir_json=bundle_json,
        related_object_type="ReferralPacket",
        related_object_id=referral_packet.id,
        status="CACHED",
    )

    endpoint = getattr(settings, "HIE_ENDPOINT_URL", "") or ""
    if not endpoint:
        cache_entry.status = "FAILED"
        cache_entry.transmission_detail = (
            "HIE_ENDPOINT_URL is not configured — Phase 6 stub, no live transmission "
            "attempted. Real transmission requires the facility's mutual-TLS client "
            "certificate per docs/08-DHA-SHA-INTEGRATION.md §8.4."
        )
        cache_entry.save(update_fields=["status", "transmission_detail"])
        return cache_entry

    client_cert = getattr(settings, "HIE_MTLS_CLIENT_CERT", "") or ""
    client_key = getattr(settings, "HIE_MTLS_CLIENT_KEY", "") or ""
    try:
        response = requests.post(
            endpoint,
            json=bundle_json,
            cert=(client_cert, client_key) if client_cert and client_key else None,
            timeout=30,
        )
        response.raise_for_status()
        cache_entry.status = "SENT"
        cache_entry.transmission_detail = f"HTTP {response.status_code}"
    except requests.RequestException as exc:
        cache_entry.status = "FAILED"
        cache_entry.transmission_detail = str(exc)
    cache_entry.save(update_fields=["status", "transmission_detail"])
    return cache_entry
