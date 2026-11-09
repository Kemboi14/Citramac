"""
Every document slot on a practitioner's profile takes many files, and a
practitioner may record registrations with more than one regulator
(2026-11-09).

PractitionerCredentialDocument holds each file. The single files that were
on the profile (registration certificate, NACADA certificate, indemnity
cover, and each entry's document) are copied into it before the old columns
are dropped; the stored files are not moved, the new rows point at them. The
reverse copies the first file of each slot back and hides any registration
entries, which the older code doesn't know.
"""

import uuid

import django.db.models.deletion
import django.db.models.manager
from django.conf import settings
from django.db import migrations, models
from django.utils import timezone

from apps.tenancy.rls import enable_rls

RLS_FORWARD, RLS_REVERSE = enable_rls("accounts_practitionercredentialdocument")

SLOT_FIELDS = {
    "REGISTRATION": "registration_evidence",
    "NACADA": "nacada_evidence",
    "INDEMNITY": "indemnity_evidence",
}


def _bypass_rls(schema_editor):
    with schema_editor.connection.cursor() as cursor:
        cursor.execute("SELECT set_config('app.is_platform_admin', 'true', true)")


def _size(field):
    try:
        return field.size
    except Exception:  # nosec B110 — a missing stored file still gets its row
        return 0


def forwards(apps, schema_editor):
    _bypass_rls(schema_editor)
    Credential = apps.get_model("accounts", "PractitionerCredential")
    Item = apps.get_model("accounts", "PractitionerCredentialItem")
    Document = apps.get_model("accounts", "PractitionerCredentialDocument")

    def copy(cred, slot, field, item=None):
        if not field:
            return
        Document.objects.create(
            organization_id=cred.organization_id,
            credential=cred,
            slot=slot,
            item=item,
            file=field.name,
            original_name=field.name.rsplit("/", 1)[-1][:255],
            size=_size(field),
        )

    for cred in Credential.objects.all():
        for slot, attr in SLOT_FIELDS.items():
            copy(cred, slot, getattr(cred, attr))
    for item in Item.objects.select_related("credential"):
        copy(item.credential, "ITEM", item.evidence, item)


def backwards(apps, schema_editor):
    _bypass_rls(schema_editor)
    Credential = apps.get_model("accounts", "PractitionerCredential")
    Item = apps.get_model("accounts", "PractitionerCredentialItem")
    Document = apps.get_model("accounts", "PractitionerCredentialDocument")
    live = Document.objects.filter(removed_at__isnull=True).order_by("created_at")
    for cred in Credential.objects.all():
        for slot, attr in SLOT_FIELDS.items():
            first = live.filter(credential=cred, slot=slot, item__isnull=True).first()
            setattr(cred, attr, first.file.name if first else None)
        cred.save()
    for item in Item.objects.all():
        first = live.filter(item=item).first()
        item.evidence = first.file.name if first else None
        item.save()
    Item.objects.filter(kind="REGISTRATION", removed_at__isnull=True).update(
        removed_at=timezone.now()
    )


class Migration(migrations.Migration):

    dependencies = [
        ("accounts", "0025_practitioner_credential_items"),
        ("tenancy", "0022_organization_nacada_report_email"),
    ]

    operations = [
        migrations.AddField(
            model_name="practitionercredentialitem",
            name="regulator",
            field=models.CharField(
                blank=True,
                choices=[
                    ("KMPDC", "Kenya Medical Practitioners and Dentists Council (KMPDC)"),
                    ("COC", "Clinical Officers Council (COC)"),
                    ("NCK", "Nursing Council of Kenya (NCK)"),
                    ("CPB", "Counsellors and Psychologists Board"),
                    ("PPB", "Pharmacy and Poisons Board (PPB)"),
                    (
                        "KMLTTB",
                        "Kenya Medical Laboratory Technicians and Technologists Board (KMLTTB)",
                    ),
                    ("OTHER", "Other (name it)"),
                ],
                max_length=8,
            ),
        ),
        migrations.AlterField(
            model_name="practitionercredentialitem",
            name="kind",
            field=models.CharField(
                choices=[
                    ("REGISTRATION", "Registration with another regulator"),
                    ("LICENCE", "Practising licence"),
                    ("DEGREE", "Degree"),
                    ("DIPLOMA", "Diploma"),
                    ("CERTIFICATE", "Certificate"),
                    ("OTHER", "Other qualification"),
                ],
                max_length=12,
            ),
        ),
        migrations.CreateModel(
            name="PractitionerCredentialDocument",
            fields=[
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("updated_at", models.DateTimeField(auto_now=True)),
                (
                    "id",
                    models.UUIDField(
                        default=uuid.uuid4, editable=False, primary_key=True, serialize=False
                    ),
                ),
                (
                    "slot",
                    models.CharField(
                        choices=[
                            ("REGISTRATION", "Registration certificate"),
                            ("NACADA", "NACADA accreditation certificate"),
                            ("INDEMNITY", "Professional indemnity cover"),
                            ("ITEM", "Entry document"),
                        ],
                        max_length=12,
                    ),
                ),
                ("file", models.FileField(upload_to="credentials/documents/%Y/%m/")),
                ("original_name", models.CharField(blank=True, max_length=255)),
                ("size", models.PositiveIntegerField(default=0)),
                ("removed_at", models.DateTimeField(blank=True, null=True)),
                (
                    "credential",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="documents",
                        to="accounts.practitionercredential",
                    ),
                ),
                (
                    "item",
                    models.ForeignKey(
                        blank=True,
                        null=True,
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="documents",
                        to="accounts.practitionercredentialitem",
                    ),
                ),
                (
                    "organization",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.PROTECT, to="tenancy.organization"
                    ),
                ),
                (
                    "removed_by",
                    models.ForeignKey(
                        blank=True,
                        null=True,
                        on_delete=django.db.models.deletion.SET_NULL,
                        related_name="+",
                        to=settings.AUTH_USER_MODEL,
                    ),
                ),
                (
                    "uploaded_by",
                    models.ForeignKey(
                        blank=True,
                        null=True,
                        on_delete=django.db.models.deletion.SET_NULL,
                        related_name="+",
                        to=settings.AUTH_USER_MODEL,
                    ),
                ),
            ],
            options={
                "ordering": ["created_at"],
                "constraints": [
                    models.CheckConstraint(
                        condition=models.Q(
                            models.Q(("item__isnull", False), ("slot", "ITEM")),
                            models.Q(
                                models.Q(("slot", "ITEM"), _negated=True), ("item__isnull", True)
                            ),
                            _connector="OR",
                        ),
                        name="practitioner_document_item_matches_slot",
                    )
                ],
            },
            managers=[
                ("objects", django.db.models.manager.Manager()),
                ("all_objects", django.db.models.manager.Manager()),
            ],
        ),
        migrations.RunSQL(RLS_FORWARD, RLS_REVERSE),
        migrations.RunPython(forwards, backwards),
        migrations.RemoveField(
            model_name="practitionercredential",
            name="indemnity_evidence",
        ),
        migrations.RemoveField(
            model_name="practitionercredential",
            name="nacada_evidence",
        ),
        migrations.RemoveField(
            model_name="practitionercredential",
            name="registration_evidence",
        ),
        migrations.RemoveField(
            model_name="practitionercredentialitem",
            name="evidence",
        ),
    ]
