"""
Retention arithmetic and the archive lifecycle: scan → batch → approve
(archive) / reject, restore, legal hold.

When a client record falls due: its retention clock starts at the client's
last activity — the latest `updated_at` of any row in their record
(apps.retention.registry), or a future appointment date if one is later —
or, for someone who was a minor at that point, no earlier than the
birthday on which they reach RetentionPlatformSettings.minor_clock_start_age.
It runs for the longest period that applies to what the record contains:
clinical always, plus mental health / substance use if there is any such
row, plus financial if there is any billing or claims row. A client with an
open encounter, a current admission, a legal hold, or who is
already in a pending batch is never due.

Nothing here archives on its own. The scan proposes; an Org Admin approves;
and approval is refused outright until a Super Admin has recorded where the
statutory floor was confirmed (RetentionPlatformSettings.floor_verified).
"""

import secrets
from dataclasses import dataclass
from datetime import date, datetime, time, timedelta

from django.conf import settings
from django.db import transaction
from django.db.models import Max
from django.utils import timezone
from rest_framework.exceptions import ValidationError

from apps.sysadmin_audit.audit import write_entry
from apps.sysadmin_audit.models import AuditLogEntry
from apps.tenancy.context import platform_admin_context

from .models import (
    ArchiveBatch,
    ArchiveBatchItem,
    OrganizationRetentionPolicy,
    RetentionPlatformSettings,
    RetentionScanRun,
)
from .registry import (
    ADMINISTRATIVE_MODELS,
    FINANCIAL_MODELS,
    MENTAL_HEALTH_MODELS,
    patient_models,
)


def _add_years(value, years):
    try:
        return value.replace(year=value.year + years)
    except ValueError:  # 29 February into a non-leap year
        return value.replace(year=value.year + years, day=28)


def effective_years(organization_id, platform=None):
    """The periods actually applied: the tenant's own, never below the floor."""
    platform = platform or RetentionPlatformSettings.get_solo()
    policy = OrganizationRetentionPolicy.all_objects.filter(organization_id=organization_id).first()

    def pick(own, floor):
        return max(floor, own or 0)

    return {
        "clinical": pick(policy and policy.clinical_years, platform.clinical_floor_years),
        "mental_health": pick(
            policy and policy.mental_health_years, platform.mental_health_floor_years
        ),
        "financial": pick(policy and policy.financial_years, platform.financial_floor_years),
    }


@dataclass
class ClientRetention:
    patient_id: object
    last_activity_at: datetime
    retention_years: int
    retention_ends_on: date


def _activity_index(organization_id, patient_ids=None, clinical_only=False):
    """
    One grouped query per registered model: latest updated_at per patient,
    and which patients have mental-health or financial rows. With
    `clinical_only`, administrative models (registry.ADMINISTRATIVE_MODELS)
    and appointments don't count as activity.
    """
    last = {}
    mental_health, financial = set(), set()
    for model, path in patient_models():
        key = path or "id"
        queryset = model._base_manager.filter(organization_id=organization_id)
        if patient_ids is not None:
            queryset = queryset.filter(**{f"{key}__in": patient_ids})
        rows = queryset.values_list(key).annotate(latest=Max("updated_at"))
        label = model._meta.label
        counts_as_activity = not (clinical_only and label in ADMINISTRATIVE_MODELS)
        for patient_id, latest in rows:
            if patient_id is None:
                continue
            if (
                counts_as_activity
                and latest
                and (patient_id not in last or latest > last[patient_id])
            ):
                last[patient_id] = latest
            if label in MENTAL_HEALTH_MODELS:
                mental_health.add(patient_id)
            if label in FINANCIAL_MODELS:
                financial.add(patient_id)

    if clinical_only:
        return last, mental_health, financial

    # A booked future appointment is ongoing care even if nothing was edited.
    from apps.client_registry.models import Appointment

    appointments = Appointment.all_objects.filter(organization_id=organization_id)
    if patient_ids is not None:
        appointments = appointments.filter(patient_id__in=patient_ids)
    for patient_id, latest in appointments.values_list("patient_id").annotate(
        latest=Max("scheduled_for")
    ):
        if latest and latest > last.get(patient_id, latest - timedelta(seconds=1)):
            last[patient_id] = latest
    return last, mental_health, financial


def _in_active_care(organization_id):
    from apps.clinical_encounter.models import Encounter
    from apps.ipd_ward.models import Admission

    open_encounters = Encounter.all_objects.filter(organization_id=organization_id).exclude(
        status="CLOSED"
    )
    admitted = Admission.all_objects.filter(organization_id=organization_id, status="ADMITTED")
    return set(open_encounters.values_list("patient_id", flat=True)) | set(
        admitted.values_list("patient_id", flat=True)
    )


def _client_retention(patient_id, date_of_birth, last, mental_health, financial, years, platform):
    clock_start = last[patient_id]
    age = platform.minor_clock_start_age
    tz = timezone.get_current_timezone()
    if age is not None and date_of_birth:
        majority = timezone.make_aware(
            datetime.combine(_add_years(date_of_birth, age), time.min), tz
        )
        clock_start = max(clock_start, majority)
    applicable = [years["clinical"]]
    if patient_id in mental_health:
        applicable.append(years["mental_health"])
    if patient_id in financial:
        applicable.append(years["financial"])
    retention_years = max(applicable)
    return ClientRetention(
        patient_id=patient_id,
        last_activity_at=last[patient_id],
        retention_years=retention_years,
        retention_ends_on=_add_years(timezone.localtime(clock_start, tz).date(), retention_years),
    )


def clinical_retention_for_patient(patient, platform=None):
    """
    This one client's statutory-minimum end date, timed from their last
    *clinical* activity, regardless of archive, hold or care state — for the
    erasure workflow's retention-conflict check. None if the record holds no
    clinical rows at all (registration only).
    """
    platform = platform or RetentionPlatformSettings.get_solo()
    years = effective_years(patient.organization_id, platform)
    last, mental_health, financial = _activity_index(
        patient.organization_id, [patient.id], clinical_only=True
    )
    if patient.id not in last:
        return None
    return _client_retention(
        patient.id, patient.date_of_birth, last, mental_health, financial, years, platform
    )


def is_in_active_care(patient):
    return patient.id in _in_active_care(patient.organization_id)


def compute_client_retention(organization_id, platform=None, patient_ids=None, for_batch=None):
    """
    ClientRetention for every client of the organization that is eligible
    to be considered at all (not archived, not on legal hold, not in active
    care, not already in a pending batch) — due or not.

    `patient_ids` narrows the computation to those clients. `for_batch`
    re-checks a pending batch's own members, which would otherwise be
    excluded as "already in a pending batch".
    """
    from apps.client_registry.models import Patient

    platform = platform or RetentionPlatformSettings.get_solo()
    years = effective_years(organization_id, platform)
    last, mental_health, financial = _activity_index(organization_id, patient_ids)
    pending = ArchiveBatchItem.all_objects.filter(
        organization_id=organization_id, batch__status=ArchiveBatch.STATUS_PENDING
    )
    if for_batch is not None:
        pending = pending.exclude(batch=for_batch)
    excluded = _in_active_care(organization_id) | set(pending.values_list("patient_id", flat=True))
    candidates = Patient.all_objects.filter(
        organization_id=organization_id, archived_at__isnull=True, legal_hold=False
    )
    if patient_ids is not None:
        candidates = candidates.filter(id__in=patient_ids)
    candidates = candidates.values_list("id", "date_of_birth")

    results = []
    for patient_id, date_of_birth in candidates:
        if patient_id in excluded or patient_id not in last:
            continue
        results.append(
            _client_retention(
                patient_id, date_of_birth, last, mental_health, financial, years, platform
            )
        )
    return results


def _new_reference(today):
    return f"ARC-{today:%Y%m%d}-{secrets.token_hex(3).upper()}"


def scan_organization(organization, today=None, notify=True):
    """
    Runs the retention scan for one organization: proposes a batch for
    everything due, computes the coming-due forecast, records the run, and
    notifies the org's admins. Idempotent within a day — the batch excludes
    anyone already pending, and notices are deduplicated.
    """
    today = today or timezone.localdate()
    platform = RetentionPlatformSettings.get_solo()
    policy = OrganizationRetentionPolicy.all_objects.filter(organization=organization).first()
    if policy is not None and not policy.scan_enabled:
        return RetentionScanRun.all_objects.create(
            organization=organization,
            outcome=RetentionScanRun.OUTCOME_SKIPPED,
            floor_verified=platform.floor_verified,
        )

    clients = compute_client_retention(organization.id, platform)
    due = [c for c in clients if c.retention_ends_on <= today]
    windows = sorted({int(w) for w in (platform.forecast_windows_days or []) if int(w) > 0})
    forecast = {
        str(w): sum(1 for c in clients if today < c.retention_ends_on <= today + timedelta(days=w))
        for w in windows
    }

    batch = None
    with transaction.atomic():
        if due:
            batch = ArchiveBatch.all_objects.create(
                organization=organization,
                reference=_new_reference(today),
                item_count=len(due),
            )
            ArchiveBatchItem.all_objects.bulk_create(
                [
                    ArchiveBatchItem(
                        organization=organization,
                        batch=batch,
                        patient_id=c.patient_id,
                        last_activity_at=c.last_activity_at,
                        retention_years=c.retention_years,
                        retention_ends_on=c.retention_ends_on,
                    )
                    for c in due
                ]
            )
        run = RetentionScanRun.all_objects.create(
            organization=organization,
            outcome=RetentionScanRun.OUTCOME_OK,
            due_count=len(due),
            forecast=forecast,
            batch=batch,
            floor_verified=platform.floor_verified,
        )
        if notify:
            from .notices import notify_batch_proposed, notify_forecast

            if batch is not None:
                notify_batch_proposed(organization, batch, platform.floor_verified)
            notify_forecast(organization, forecast, today)
    return run


def scan_all_organizations(today=None):
    """Platform-wide scan — one run per organization, failures isolated per org."""
    import structlog

    from apps.tenancy.models import Organization

    logger = structlog.get_logger(__name__)
    runs = []
    with platform_admin_context():
        for organization in Organization.objects.all():
            try:
                runs.append(scan_organization(organization, today=today))
            except Exception as exc:  # noqa: BLE001 — record it, keep scanning others
                logger.exception("retention_scan_failed", organization_id=str(organization.id))
                RetentionScanRun.all_objects.create(
                    organization=organization,
                    outcome=RetentionScanRun.OUTCOME_FAILED,
                    error=f"{type(exc).__name__}: {exc}",
                )
    return runs


def _require_pending(batch):
    if batch.status != ArchiveBatch.STATUS_PENDING:
        raise ValidationError({"status": "This batch has already been decided."})


def approve_batch(batch, user, note=""):
    """
    Archives every client in the batch that is still due. A client whose
    record changed since the batch was proposed, who went onto legal hold,
    or who re-entered active care is skipped and stays active.
    """
    from apps.client_registry.models import Patient

    platform = RetentionPlatformSettings.get_solo()
    if not platform.floor_verified:
        raise ValidationError(
            {
                "floor_verified": (
                    "Archiving is disabled until the platform's statutory retention periods "
                    "have been confirmed and recorded by a Super Admin."
                )
            }
        )
    _require_pending(batch)

    now = timezone.now()
    today = timezone.localdate()
    member_ids = list(batch.items.values_list("patient_id", flat=True))
    current = {
        c.patient_id
        for c in compute_client_retention(
            batch.organization_id, platform, patient_ids=member_ids, for_batch=batch
        )
        if c.retention_ends_on <= today
    }

    archived, skipped = [], []
    with transaction.atomic():
        for item in batch.items.select_related("patient"):
            patient = item.patient
            if patient.archived_at is not None:
                item_outcome = "already archived"
            elif item.patient_id not in current:
                item_outcome = "no longer due (new activity, legal hold or active care)"
            else:
                item_outcome = None
            if item_outcome:
                skipped.append((item, item_outcome))
                continue
            patient.archived_at = now
            patient.archived_by = user
            patient.archive_reason = Patient.ARCHIVE_REASON_RETENTION
            patient.save(
                update_fields=["archived_at", "archived_by", "archive_reason", "updated_at"]
            )
            write_entry(
                patient,
                AuditLogEntry.ACTION_ARCHIVE,
                {
                    "batch": {"old": None, "new": batch.reference},
                    "reason": {"old": None, "new": Patient.ARCHIVE_REASON_RETENTION},
                    "retention_years": {"old": None, "new": item.retention_years},
                    "retention_ends_on": {"old": None, "new": str(item.retention_ends_on)},
                },
            )
            archived.append(item)

        for item, reason in skipped:
            item.outcome = ArchiveBatchItem.OUTCOME_SKIPPED
            item.skip_reason = reason
            item.save(update_fields=["outcome", "skip_reason"])
        for item in archived:
            item.outcome = ArchiveBatchItem.OUTCOME_ARCHIVED
            item.save(update_fields=["outcome"])

        batch.status = ArchiveBatch.STATUS_ARCHIVED
        batch.decided_by = user
        batch.decided_at = now
        batch.decision_note = note
        batch.archived_count = len(archived)
        batch.skipped_count = len(skipped)
        batch.save(
            update_fields=[
                "status",
                "decided_by",
                "decided_at",
                "decision_note",
                "archived_count",
                "skipped_count",
            ]
        )

        from .notices import notify_batch_archived

        notify_batch_archived(batch)
    return batch


def reject_batch(batch, user, note):
    if not (note or "").strip():
        raise ValidationError({"note": "Say why this batch is being rejected."})
    _require_pending(batch)
    batch.status = ArchiveBatch.STATUS_REJECTED
    batch.decided_by = user
    batch.decided_at = timezone.now()
    batch.decision_note = note.strip()
    batch.save(update_fields=["status", "decided_by", "decided_at", "decision_note"])
    return batch


def restore_patient(patient, user, reason):
    """
    Brings an archived client record back into the active registry. The
    restore itself counts as activity, so the retention clock restarts.
    """
    if patient.archived_at is None:
        raise ValidationError({"patient": "This client record is not archived."})
    if not (reason or "").strip():
        raise ValidationError({"reason": "A reason is required to restore an archived record."})
    previous = patient.archived_at
    patient.archived_at = None
    patient.archived_by = None
    patient.archive_reason = ""
    patient.save(update_fields=["archived_at", "archived_by", "archive_reason", "updated_at"])
    write_entry(
        patient,
        AuditLogEntry.ACTION_RESTORE,
        {
            "archived_at": {"old": previous.isoformat(), "new": None},
            "reason": {"old": None, "new": reason.strip()},
        },
    )
    return patient


def set_legal_hold(patient, user, on, reason):
    if on and not (reason or "").strip():
        raise ValidationError({"reason": "A reason is required to place a legal hold."})
    if patient.legal_hold == on:
        return patient
    patient.legal_hold = on
    patient.legal_hold_reason = reason.strip() if on else ""
    patient.legal_hold_set_at = timezone.now() if on else None
    patient.legal_hold_set_by = user if on else None
    patient.save(
        update_fields=[
            "legal_hold",
            "legal_hold_reason",
            "legal_hold_set_at",
            "legal_hold_set_by",
            "updated_at",
        ]
    )
    write_entry(
        patient,
        AuditLogEntry.ACTION_LEGAL_HOLD,
        {
            "legal_hold": {"old": not on, "new": on},
            "reason": {"old": None, "new": (reason or "").strip()},
        },
    )
    return patient


def retention_status_for(patient, platform=None):
    """Per-client summary for the chart header: when the record falls due, and why."""
    if patient.archived_at is not None:
        return {"state": "ARCHIVED", "retention_ends_on": None}
    if patient.legal_hold:
        return {"state": "LEGAL_HOLD", "retention_ends_on": None}
    for client in compute_client_retention(
        patient.organization_id, platform, patient_ids=[patient.id]
    ):
        if client.patient_id == patient.id:
            return {
                "state": "ACTIVE",
                "retention_ends_on": client.retention_ends_on,
                "retention_years": client.retention_years,
                "last_activity_at": client.last_activity_at,
            }
    return {"state": "IN_CARE_OR_PENDING", "retention_ends_on": None}


def frontend_url(path):
    return f"{settings.FRONTEND_URL.rstrip('/')}{path}"
