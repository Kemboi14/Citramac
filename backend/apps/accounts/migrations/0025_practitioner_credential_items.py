"""
Practising licences, degrees, diplomas and certificates become entries of
their own (PractitionerCredentialItem), as many as a practitioner holds, each
with its document (2026-11-09).

Each profile's single licence (number, dates, document, verification) is
copied into a LICENCE entry, and its qualifications line + certificate into
one qualification entry, before the old columns are dropped. Files are not
moved: the entry points at the same stored file. The reverse copies the
latest licence and the first qualification document back.
"""

import uuid

import django.db.models.deletion
import django.db.models.manager
from django.conf import settings
from django.db import migrations, models

from apps.tenancy.rls import enable_rls

RLS_FORWARD, RLS_REVERSE = enable_rls("accounts_practitionercredentialitem")


def _bypass_rls(schema_editor):
    with schema_editor.connection.cursor() as cursor:
        cursor.execute("SELECT set_config('app.is_platform_admin', 'true', true)")


def forwards(apps, schema_editor):
    _bypass_rls(schema_editor)
    Credential = apps.get_model("accounts", "PractitionerCredential")
    Item = apps.get_model("accounts", "PractitionerCredentialItem")
    for cred in Credential.objects.all():
        verified = cred.profile_status == "VERIFIED"
        if (
            cred.licence_number.strip()
            or cred.licence_expires_on
            or cred.licence_issued_on
            or cred.licence_evidence
        ):
            Item.objects.create(
                organization_id=cred.organization_id,
                credential=cred,
                kind="LICENCE",
                issuer=cred.registration_body,
                number=cred.licence_number,
                issued_on=cred.licence_issued_on,
                expires_on=cred.licence_expires_on,
                evidence=cred.licence_evidence.name or None,
                verified_at=cred.licence_verified_at,
                verified_by_id=cred.licence_verified_by_id,
            )
        if cred.qualifications.strip() or cred.qualification_evidence:
            Item.objects.create(
                organization_id=cred.organization_id,
                credential=cred,
                kind="OTHER",
                title=cred.qualifications.strip()[:150],
                evidence=cred.qualification_evidence.name or None,
                # verify() checked the certificate with the rest of the profile.
                verified_at=cred.licence_verified_at if verified else None,
                verified_by_id=cred.licence_verified_by_id if verified else None,
            )


def backwards(apps, schema_editor):
    _bypass_rls(schema_editor)
    Credential = apps.get_model("accounts", "PractitionerCredential")
    Item = apps.get_model("accounts", "PractitionerCredentialItem")
    for cred in Credential.objects.all():
        items = Item.objects.filter(credential=cred, removed_at__isnull=True)
        licence = items.filter(kind="LICENCE").order_by("-expires_on", "-created_at").first()
        if licence is not None:
            cred.licence_number = licence.number
            cred.licence_issued_on = licence.issued_on
            cred.licence_expires_on = licence.expires_on
            cred.licence_evidence = licence.evidence.name or None
            cred.licence_verified_at = licence.verified_at
            cred.licence_verified_by_id = licence.verified_by_id
        qualification = (
            (items.exclude(kind="LICENCE").exclude(evidence="").exclude(evidence__isnull=True))
            .order_by("created_at")
            .first()
        )
        if qualification is not None:
            cred.qualification_evidence = qualification.evidence.name
        cred.save()


class Migration(migrations.Migration):

    dependencies = [
        ("accounts", "0024_pharmacy_dispense"),
        ("tenancy", "0022_organization_nacada_report_email"),
    ]

    operations = [
        migrations.CreateModel(
            name="PractitionerCredentialItem",
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
                    "kind",
                    models.CharField(
                        choices=[
                            ("LICENCE", "Practising licence"),
                            ("DEGREE", "Degree"),
                            ("DIPLOMA", "Diploma"),
                            ("CERTIFICATE", "Certificate"),
                            ("OTHER", "Other qualification"),
                        ],
                        max_length=12,
                    ),
                ),
                ("title", models.CharField(blank=True, max_length=150)),
                ("issuer", models.CharField(blank=True, max_length=150)),
                ("number", models.CharField(blank=True, max_length=64)),
                ("issued_on", models.DateField(blank=True, null=True)),
                ("expires_on", models.DateField(blank=True, null=True)),
                (
                    "evidence",
                    models.FileField(blank=True, null=True, upload_to="credentials/items/%Y/%m/"),
                ),
                ("verified_at", models.DateTimeField(blank=True, null=True)),
                ("removed_at", models.DateTimeField(blank=True, null=True)),
                (
                    "credential",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="items",
                        to="accounts.practitionercredential",
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
                    "verified_by",
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
            name="licence_evidence",
        ),
        migrations.RemoveField(
            model_name="practitionercredential",
            name="licence_expires_on",
        ),
        migrations.RemoveField(
            model_name="practitionercredential",
            name="licence_issued_on",
        ),
        migrations.RemoveField(
            model_name="practitionercredential",
            name="licence_number",
        ),
        migrations.RemoveField(
            model_name="practitionercredential",
            name="licence_verified_at",
        ),
        migrations.RemoveField(
            model_name="practitionercredential",
            name="licence_verified_by",
        ),
        migrations.RemoveField(
            model_name="practitionercredential",
            name="qualification_evidence",
        ),
    ]
