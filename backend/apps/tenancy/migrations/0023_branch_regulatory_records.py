"""
Branch regulatory documents (2026-11-09): BranchRegulatoryRecord — as many
per branch as it needs — and BranchRegulatoryFile, as many files per record.
Both are tenant tables, so both get the standard RLS policy
(apps.tenancy.rls). Additive only; the branch's registration numbers and
their history are unchanged.
"""

import uuid

import django.db.models.deletion
import django.db.models.manager
from django.conf import settings
from django.db import migrations, models

from apps.tenancy.rls import enable_rls_for_tables

RLS_FORWARD, RLS_REVERSE = enable_rls_for_tables(
    "tenancy_branchregulatoryrecord", "tenancy_branchregulatoryfile"
)


class Migration(migrations.Migration):

    dependencies = [
        ("tenancy", "0022_organization_nacada_report_email"),
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [
        migrations.CreateModel(
            name="BranchRegulatoryRecord",
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
                    "regulator",
                    models.CharField(
                        choices=[
                            (
                                "KMPDC",
                                "Kenya Medical Practitioners and Dentists Council (KMPDC)",
                            ),
                            ("NACADA", "NACADA"),
                            ("PPB", "Pharmacy and Poisons Board (PPB)"),
                            ("OTHER", "Other (name it)"),
                        ],
                        max_length=8,
                    ),
                ),
                ("regulator_name", models.CharField(blank=True, max_length=150)),
                ("document_type", models.CharField(max_length=150)),
                ("number", models.CharField(blank=True, max_length=64)),
                ("issued_on", models.DateField(blank=True, null=True)),
                ("valid_until", models.DateField(blank=True, null=True)),
                ("removed_at", models.DateTimeField(blank=True, null=True)),
                (
                    "branch",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.PROTECT,
                        related_name="regulatory_records",
                        to="tenancy.branch",
                    ),
                ),
                (
                    "created_by",
                    models.ForeignKey(
                        blank=True,
                        null=True,
                        on_delete=django.db.models.deletion.SET_NULL,
                        related_name="+",
                        to=settings.AUTH_USER_MODEL,
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
            ],
            options={
                "ordering": ["-created_at"],
                "abstract": False,
                "base_manager_name": "all_objects",
            },
            managers=[
                ("objects", django.db.models.manager.Manager()),
                ("all_objects", django.db.models.manager.Manager()),
            ],
        ),
        migrations.CreateModel(
            name="BranchRegulatoryFile",
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
                    "file",
                    models.FileField(max_length=255, upload_to="branches/regulatory/%Y/%m/"),
                ),
                ("original_name", models.CharField(max_length=255)),
                ("size", models.PositiveIntegerField()),
                ("removed_at", models.DateTimeField(blank=True, null=True)),
                (
                    "organization",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.PROTECT, to="tenancy.organization"
                    ),
                ),
                (
                    "record",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.PROTECT,
                        related_name="files",
                        to="tenancy.branchregulatoryrecord",
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
                "abstract": False,
                "base_manager_name": "all_objects",
            },
            managers=[
                ("objects", django.db.models.manager.Manager()),
                ("all_objects", django.db.models.manager.Manager()),
            ],
        ),
        migrations.RunSQL(RLS_FORWARD, reverse_sql=RLS_REVERSE),
    ]
