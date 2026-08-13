"""
Generic terminology mirror sync — docs/08-DHA-SHA-INTEGRATION.md §8.2's
"generic TerminologySyncJob Celery task pattern reused for all three
mirrors, each configurable with its own source endpoint and refresh
cadence." No live WHO ICD-11 API / LOINC distribution / national drug
registry endpoint is configured in this environment — `sync_terminology_source`
honestly records a SKIPPED_NOT_CONFIGURED run rather than fabricating a
successful sync, consistent with the sha_gateway.py/hie_client.py stub
pattern established in Phase 4/6.

Expected source response shape (once a real endpoint is configured): a JSON
array of `{"code": ..., "description": ...}` objects (ICD-11/LOINC) or
`{"code", "generic_name", "form", "strength"}` (National Drug Index) — the
exact real-world schema depends on the provider and should be adapted here
once sandbox access exists.
"""

import requests
from django.conf import settings
from django.utils import timezone

from .models import IcdCodeIndex, LoincCodeIndex, NationalDrugIndex, TerminologySyncRun

SOURCE_CONFIG = {
    "ICD11": {
        "model": IcdCodeIndex,
        "setting": "ICD11_SYNC_SOURCE_URL",
        "fields": ["code", "description"],
    },
    "LOINC": {
        "model": LoincCodeIndex,
        "setting": "LOINC_SYNC_SOURCE_URL",
        "fields": ["code", "description"],
    },
    "NATIONAL_DRUG_INDEX": {
        "model": NationalDrugIndex,
        "setting": "NATIONAL_DRUG_INDEX_SYNC_SOURCE_URL",
        "fields": ["code", "generic_name", "form", "strength"],
    },
}


def sync_terminology_source(source_key):
    """Runs one mirror's sync and returns the TerminologySyncRun audit row."""
    config = SOURCE_CONFIG[source_key]
    run = TerminologySyncRun.objects.create(source=source_key, status="FAILED")

    source_url = getattr(settings, config["setting"], "") or ""
    if not source_url:
        run.status = "SKIPPED_NOT_CONFIGURED"
        run.detail = (
            f"settings.{config['setting']} is not configured — Phase 6 stub, no live "
            "sync attempted."
        )
        run.finished_at = timezone.now()
        run.save(update_fields=["status", "detail", "finished_at"])
        return run

    model = config["model"]
    fields = config["fields"]
    try:
        response = requests.get(source_url, timeout=60)
        response.raise_for_status()
        records = response.json()
        count = 0
        for record in records:
            defaults = {field: record[field] for field in fields if field != "code"}
            model.objects.update_or_create(code=record["code"], defaults=defaults)
            count += 1
        run.status = "SUCCESS"
        run.records_synced = count
    except (requests.RequestException, KeyError, ValueError) as exc:
        run.status = "FAILED"
        run.detail = str(exc)
    run.finished_at = timezone.now()
    run.save(update_fields=["status", "records_synced", "detail", "finished_at"])
    return run
