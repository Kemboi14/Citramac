"""
Paper copies of statutory admission forms, uploaded in the admission flow.

A form is downloaded (legal_print), signed by hand where that is needed, and the
scan is uploaded beside it. The copy is evidence only: it never signs the form,
changes its status or replaces the system's own signature. It is stored in the
client's single attachment store (client_registry.Attachment, linked to the form
and, when there is one, the admission) — not a second store.

FHIR: a `DocumentReference` (content = the PDF / image, `context.encounter` =
the admission Encounter, `relatesTo` the form) on the admission's EpisodeOfCare,
restricted (R + PSY) and never sent to the SHR. Not emitted yet. VERIFY: a LOINC
document type for a statutory admission form; until confirmed it is text only.

Every upload, download and removal is audited. The audit trail records the
file's SHA-256 and size, never its content.
"""

import hashlib

from django.core.exceptions import ValidationError as DjangoValidationError
from django.db import transaction
from django.http import FileResponse
from django.utils import timezone
from rest_framework.exceptions import NotFound, PermissionDenied, ValidationError

from apps.accounts.practitioner_profile import check_upload
from apps.client_registry.models import Attachment
from apps.sysadmin_audit.audit import write_event
from apps.sysadmin_audit.models import AuditLogEntry

AUDIT_MODEL = "care_pathway.legaldocument"


def _sha256(upload):
    digest = hashlib.sha256()
    for chunk in upload.chunks():
        digest.update(chunk)
    upload.seek(0)
    return digest.hexdigest()


def _admission_for(doc):
    """The admission this form's legal status admitted, if one exists yet."""
    from apps.ipd_ward.models import Admission

    return (
        Admission.objects.filter(legal_status_record_id=doc.legal_status_id)
        .order_by("-admitted_at")
        .first()
    )


def _active(doc):
    return doc.copies.filter(doc_status="ACTIVE").select_related("uploaded_by")


def rows(doc):
    """The form's current copies, newest first, for document_row()."""
    return [
        {
            "id": str(a.pk),
            "name": a.description or a.file.name.rsplit("/", 1)[-1],
            "uploaded_by": a.uploaded_by.get_full_name() if a.uploaded_by_id else "",
            "uploaded_by_id": str(a.uploaded_by_id) if a.uploaded_by_id else None,
            "uploaded_at": a.uploaded_at.isoformat(),
        }
        for a in _active(doc).order_by("-uploaded_at")
    ]


@transaction.atomic
def upload(doc, user, file, sign_as=None):
    """Store a scanned copy of `doc` (PDF, PNG or JPEG, at most 10 MB).

    `sign_as` (the applicant fields the sign step takes: signer_kind,
    related_person_id, adult_confirmed) records an unsigned voluntary or
    involuntary application as signed by the applicant, with this copy as the
    wet signature (method WET_SCAN), in the same transaction: if the form is not
    ready to sign, nothing is stored."""
    from . import legal_status

    if sign_as is not None and doc.template_id not in legal_status.APPLICATION_TEMPLATES.values():
        raise ValidationError(
            {"file": "Only a voluntary or involuntary application is signed by uploading it."}
        )
    if doc.status == "VOID":
        raise ValidationError({"file": "This application was withdrawn."})
    check_upload(file)
    digest = _sha256(file)
    admission = _admission_for(doc)
    copy = Attachment.objects.create(
        organization_id=doc.organization_id,
        patient=doc.patient,
        admission=admission,
        legal_document=doc,
        file=file,
        classification="CURRENT",
        category="CLINICAL",
        document_type=f"Signed copy — {doc.get_template_id_display()}"[:100],
        description=(file.name or "")[:255],
        uploaded_by=user,
    )
    write_event(
        doc.organization_id,
        AuditLogEntry.ACTION_CREATE,
        AUDIT_MODEL,
        doc.pk,
        {
            "event": "signed_copy_uploaded",
            "copy": str(copy.pk),
            "document_number": doc.document_number,
            "version": doc.version,
            "admission": str(admission.pk) if admission else None,
            "sha256": digest,
            "bytes": file.size,
        },
    )
    if sign_as is not None:
        legal_status.sign(doc, user, {**sign_as, "method": "WET_SCAN", "attachment_id": copy.pk})
    return copy


def _copy(doc, copy_id):
    try:
        return _active(doc).get(pk=copy_id)
    except (Attachment.DoesNotExist, ValueError, DjangoValidationError) as exc:
        raise NotFound("No such copy of this form.") from exc


def download(doc, copy_id):
    copy = _copy(doc, copy_id)
    write_event(
        doc.organization_id,
        AuditLogEntry.ACTION_VIEW,
        AUDIT_MODEL,
        doc.pk,
        {"event": "signed_copy_downloaded", "copy": str(copy.pk)},
    )
    return FileResponse(
        copy.file.open("rb"),
        as_attachment=False,
        filename=copy.description or copy.file.name.rsplit("/", 1)[-1],
    )


@transaction.atomic
def remove(doc, copy_id, user, reason, is_org_admin):
    """Take a wrongly uploaded copy off the form. The file and row are kept
    (archived), only the uploader or an Org Admin may do it, with a reason."""
    copy = _copy(doc, copy_id)
    if copy.uploaded_by_id != user.pk and not is_org_admin:
        raise PermissionDenied(
            "Only the person who uploaded this copy or an Org Admin can remove it."
        )
    reason = (reason or "").strip()
    if len(reason) < 5:
        raise ValidationError({"reason": "Say why this copy is being removed."})
    copy.doc_status = "ARCHIVED"
    copy.save(update_fields=["doc_status"])
    write_event(
        doc.organization_id,
        AuditLogEntry.ACTION_ARCHIVE,
        AUDIT_MODEL,
        doc.pk,
        {
            "event": "signed_copy_removed",
            "copy": str(copy.pk),
            "reason": reason,
            "at": timezone.now().isoformat(),
        },
    )
