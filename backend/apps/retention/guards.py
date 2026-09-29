"""
Read-only enforcement for archived client records.

Connected (apps.retention.apps.ready) as pre_save/pre_delete on every model
in apps.retention.registry. Signals — not a check in each ViewSet — so the
guard also covers Celery tasks, management commands, Django admin and any
future endpoint that writes a clinical row. Raised as a DRF APIException so
an API request gets a clean 409 with a reason the UI can show; outside a
request it is simply an exception, which is the point.

QuerySet.update() bypasses model signals, so it bypasses this guard too.
The only such writes on registry models today are the erasure workflow
(apps.client_registry.erasure) and the archive service itself, both
deliberate.
"""

from rest_framework import status
from rest_framework.exceptions import APIException

from .registry import patient_models


class RecordArchivedError(APIException):
    status_code = status.HTTP_409_CONFLICT
    default_code = "record_archived"
    default_detail = (
        "This client record is archived and read-only. An Org Admin must restore it "
        "before anything in it can be added or changed."
    )


def _archived_filter(path):
    return {f"{path}__archived_at__isnull" if path else "archived_at__isnull": False}


def _target_is_archived(model, instance, path):
    """Does the Patient this (possibly unsaved) instance points at sit in the archive?"""
    first, _, rest = path.partition("__")
    fk_id = getattr(instance, f"{first}_id", None)
    if fk_id is None:
        return False
    parent = model._meta.get_field(first).related_model
    return parent._base_manager.filter(pk=fk_id, **_archived_filter(rest)).exists()


def _stored_row_is_archived(model, instance, path):
    """Does the row as currently stored belong to an archived Patient?"""
    if instance._state.adding or instance.pk is None:
        return False
    return model._base_manager.filter(pk=instance.pk, **_archived_filter(path)).exists()


def _make_guards(model, path):
    def guard_save(sender, instance, update_fields=None, **kwargs):
        if path == "":
            # The Patient row itself: only the archive/restore/legal-hold
            # lifecycle fields may change while it is archived.
            if not _stored_row_is_archived(model, instance, path):
                return
            if update_fields is not None and set(update_fields) <= model.LIFECYCLE_FIELDS:
                return
            raise RecordArchivedError()
        if _stored_row_is_archived(model, instance, path) or _target_is_archived(
            model, instance, path
        ):
            raise RecordArchivedError()

    def guard_delete(sender, instance, **kwargs):
        if _stored_row_is_archived(model, instance, path):
            raise RecordArchivedError()

    return guard_save, guard_delete


def connect_archive_guards():
    from django.db.models.signals import pre_delete, pre_save

    for model, path in patient_models():
        guard_save, guard_delete = _make_guards(model, path)
        pre_save.connect(
            guard_save, sender=model, weak=False, dispatch_uid=f"archive_save_{model._meta.label}"
        )
        pre_delete.connect(
            guard_delete,
            sender=model,
            weak=False,
            dispatch_uid=f"archive_delete_{model._meta.label}",
        )
