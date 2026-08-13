"""
Idempotent push/pull sync — docs/08-DHA-SHA-INTEGRATION.md §8.5: "Backend
exposes idempotent, timestamp/version-aware sync endpoints ... using a
last-write-wins-with-conflict-log strategy; conflicts are surfaced to an
Org Admin/records officer for manual resolution rather than silently
overwritten."
"""

from django.db import IntegrityError, transaction

from .handlers import ENTITY_HANDLERS
from .models import SyncableRecord, SyncConflictLog


def push_entry(organization, user, entry):
    """
    `entry`: {"client_id", "entity_type", "encounter_id", "payload", "base_version"}
    generated client-side while offline. Replaying the same `client_id`
    is safe (idempotent) — a second push with an unchanged `base_version`
    simply re-applies the same update.
    """
    client_id = entry["client_id"]
    entity_type = entry["entity_type"]
    handler = ENTITY_HANDLERS.get(entity_type)
    if handler is None:
        return {
            "client_id": client_id,
            "status": "ERROR",
            "detail": f"Unknown entity_type '{entity_type}'.",
        }

    base_version = entry.get("base_version", 0)

    with transaction.atomic():
        existing = SyncableRecord.objects.filter(
            organization=organization, client_id=client_id
        ).first()

        if existing is None:
            # Reserve the client_id before doing any domain-model work, so
            # two concurrent pushes of the same offline draft (e.g. a flaky
            # reconnect firing the flush twice) can't both create a domain
            # record. The loser's INSERT blocks on the winner's still-open
            # transaction, then either raises IntegrityError (winner
            # committed) or succeeds (winner rolled back) — Postgres's
            # normal behavior for a unique-constraint race.
            reserved = True
            try:
                with transaction.atomic():
                    SyncableRecord.objects.create(
                        organization=organization,
                        client_id=client_id,
                        entity_type=entity_type,
                        server_entity_id=None,
                        version=0,
                    )
            except IntegrityError:
                reserved = False

            existing = SyncableRecord.objects.select_for_update().get(
                organization=organization, client_id=client_id
            )

            if reserved:
                server_id = handler(organization, user, entry.get("encounter_id"), entry["payload"])
                existing.server_entity_id = server_id
                existing.version = 1
                existing.save(update_fields=["server_entity_id", "version"])
                return {
                    "client_id": client_id,
                    "status": "APPLIED",
                    "server_entity_id": str(server_id),
                    "version": 1,
                }
            # A concurrent request already reserved and completed this
            # client_id — fall through to the normal path below using the
            # result it committed, instead of doing the domain-model write
            # (and returning APPLIED) a second time.

        if base_version < existing.version:
            SyncConflictLog.objects.create(
                organization=organization,
                client_id=client_id,
                entity_type=entity_type,
                server_entity_id=existing.server_entity_id,
                incoming_payload=entry["payload"],
                client_base_version=base_version,
                server_version=existing.version,
                created_by=user,
            )
            return {
                "client_id": client_id,
                "status": "CONFLICT",
                "server_entity_id": str(existing.server_entity_id),
                "server_version": existing.version,
            }

        try:
            handler(
                organization,
                user,
                entry.get("encounter_id"),
                entry["payload"],
                server_entity_id=existing.server_entity_id,
            )
        except PermissionError as exc:
            # e.g. a signed/locked SoapNote — surfaced as a conflict for a
            # records officer, never silently dropped.
            SyncConflictLog.objects.create(
                organization=organization,
                client_id=client_id,
                entity_type=entity_type,
                server_entity_id=existing.server_entity_id,
                incoming_payload=entry["payload"],
                client_base_version=base_version,
                server_version=existing.version,
                detail=str(exc),
                created_by=user,
            )
            return {"client_id": client_id, "status": "CONFLICT", "detail": str(exc)}

        existing.version += 1
        existing.save(update_fields=["version"])
        return {
            "client_id": client_id,
            "status": "APPLIED",
            "server_entity_id": str(existing.server_entity_id),
            "version": existing.version,
        }


def pull_changes(organization, since):
    """Records changed since `since`, for warming the client's local cache after reconnect."""
    from django.utils import timezone

    from apps.clinical_encounter.models import SoapNote
    from apps.clinical_encounter.serializers import SoapNoteSerializer
    from apps.triage.models import VitalSigns
    from apps.triage.serializers import VitalSignsSerializer

    vitals = VitalSigns.objects.filter(organization=organization, updated_at__gt=since)
    soap_notes = SoapNote.objects.filter(organization=organization, updated_at__gt=since)
    return {
        "vitals": VitalSignsSerializer(vitals, many=True).data,
        "soap_notes": SoapNoteSerializer(soap_notes, many=True).data,
        "server_time": timezone.now().isoformat(),
    }
