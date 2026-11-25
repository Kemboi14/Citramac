"""
Accommodation types, rooms, bed stays and nightly bed-day charges (owner,
2026-11-24; guide.md). Every organisation gets the starting types Shared bed,
Shared room and Private room, each with its own unpriced "Bed-day — <name>"
tariff line. Every current admission gets an open stay starting now, so its
first charged night is tonight: no back-charges (owner's decision).
"""

import uuid

import django.db.models.deletion
import django.db.models.manager
from django.db import migrations, models
from django.utils import timezone

from apps.tenancy.rls import enable_rls_for_tables

RLS_FORWARD, RLS_REVERSE = enable_rls_for_tables(
    "ipd_ward_accommodationtype",
    "ipd_ward_room",
    "ipd_ward_bedstay",
    "ipd_ward_bednight",
)
DEFAULT_TYPES = ["Shared bed", "Shared room", "Private room"]


def _bypass_rls(schema_editor):
    with schema_editor.connection.cursor() as cursor:
        cursor.execute("SELECT set_config('app.is_platform_admin', 'true', true)")


def forwards(apps, schema_editor):
    _bypass_rls(schema_editor)
    Organization = apps.get_model("tenancy", "Organization")
    BillingService = apps.get_model("care_pathway", "BillingService")
    AccommodationType = apps.get_model("ipd_ward", "AccommodationType")
    Admission = apps.get_model("ipd_ward", "Admission")
    BedStay = apps.get_model("ipd_ward", "BedStay")
    for org in Organization.objects.all():
        for order, name in enumerate(DEFAULT_TYPES):
            service, _ = BillingService.objects.get_or_create(
                organization_id=org.id, name=f"Bed-day — {name}"
            )
            AccommodationType.objects.get_or_create(
                organization_id=org.id,
                name=name,
                defaults={"billing_service": service, "order": order},
            )
    now = timezone.now()
    taken = set()
    current = Admission.objects.filter(status__in=("ADMITTED", "TRANSFERRED"))
    for admission in current.order_by("-admitted_at"):
        if admission.bed_id in taken:
            # Two current admissions on one bed is already a data error; the
            # later one keeps the bed, and the other is reported for review.
            print(f"\n  admission {admission.id}: bed already holds a later admission; no stay")
            continue
        taken.add(admission.bed_id)
        BedStay.objects.create(
            organization_id=admission.organization_id,
            admission=admission,
            bed_id=admission.bed_id,
            started_at=now,
        )


def backwards(apps, schema_editor):
    pass  # the tables are dropped by the schema operations


class Migration(migrations.Migration):

    dependencies = [
        ("care_pathway", "0067_intake_edit_reason"),
        ("ipd_ward", "0009_admission_legal_status_record"),
        ("tenancy", "0026_organization_icon"),
    ]

    operations = [
        migrations.CreateModel(
            name="AccommodationType",
            fields=[
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("updated_at", models.DateTimeField(auto_now=True)),
                (
                    "id",
                    models.UUIDField(
                        default=uuid.uuid4, editable=False, primary_key=True, serialize=False
                    ),
                ),
                ("name", models.CharField(max_length=100)),
                ("active", models.BooleanField(default=True)),
                ("order", models.PositiveSmallIntegerField(default=0)),
                (
                    "billing_service",
                    models.OneToOneField(
                        on_delete=django.db.models.deletion.PROTECT,
                        related_name="accommodation_type",
                        to="care_pathway.billingservice",
                    ),
                ),
                (
                    "organization",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.PROTECT, to="tenancy.organization"
                    ),
                ),
            ],
            options={
                "ordering": ["order", "name"],
                "abstract": False,
                "base_manager_name": "all_objects",
            },
            managers=[
                ("objects", django.db.models.manager.Manager()),
                ("all_objects", django.db.models.manager.Manager()),
            ],
        ),
        migrations.AddField(
            model_name="bed",
            name="accommodation_type",
            field=models.ForeignKey(
                blank=True,
                null=True,
                on_delete=django.db.models.deletion.PROTECT,
                related_name="beds",
                to="ipd_ward.accommodationtype",
            ),
        ),
        migrations.CreateModel(
            name="BedStay",
            fields=[
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("updated_at", models.DateTimeField(auto_now=True)),
                (
                    "id",
                    models.UUIDField(
                        default=uuid.uuid4, editable=False, primary_key=True, serialize=False
                    ),
                ),
                ("started_at", models.DateTimeField()),
                ("ended_at", models.DateTimeField(blank=True, null=True)),
                (
                    "admission",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.PROTECT,
                        related_name="bed_stays",
                        to="ipd_ward.admission",
                    ),
                ),
                (
                    "bed",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.PROTECT,
                        related_name="stays",
                        to="ipd_ward.bed",
                    ),
                ),
                (
                    "organization",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.PROTECT, to="tenancy.organization"
                    ),
                ),
            ],
            options={
                "ordering": ["started_at"],
                "abstract": False,
                "base_manager_name": "all_objects",
            },
            managers=[
                ("objects", django.db.models.manager.Manager()),
                ("all_objects", django.db.models.manager.Manager()),
            ],
        ),
        migrations.CreateModel(
            name="BedNight",
            fields=[
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("updated_at", models.DateTimeField(auto_now=True)),
                (
                    "id",
                    models.UUIDField(
                        default=uuid.uuid4, editable=False, primary_key=True, serialize=False
                    ),
                ),
                ("night", models.DateField()),
                (
                    "accommodation_type",
                    models.ForeignKey(
                        blank=True,
                        null=True,
                        on_delete=django.db.models.deletion.PROTECT,
                        related_name="+",
                        to="ipd_ward.accommodationtype",
                    ),
                ),
                (
                    "admission",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.PROTECT,
                        related_name="bed_nights",
                        to="ipd_ward.admission",
                    ),
                ),
                (
                    "charge",
                    models.OneToOneField(
                        blank=True,
                        null=True,
                        on_delete=django.db.models.deletion.PROTECT,
                        related_name="bed_night",
                        to="care_pathway.chargeitem",
                    ),
                ),
                (
                    "organization",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.PROTECT, to="tenancy.organization"
                    ),
                ),
                (
                    "stay",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.PROTECT,
                        related_name="nights",
                        to="ipd_ward.bedstay",
                    ),
                ),
            ],
            options={
                "ordering": ["night"],
                "abstract": False,
                "base_manager_name": "all_objects",
            },
            managers=[
                ("objects", django.db.models.manager.Manager()),
                ("all_objects", django.db.models.manager.Manager()),
            ],
        ),
        migrations.CreateModel(
            name="Room",
            fields=[
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("updated_at", models.DateTimeField(auto_now=True)),
                (
                    "id",
                    models.UUIDField(
                        default=uuid.uuid4, editable=False, primary_key=True, serialize=False
                    ),
                ),
                ("name", models.CharField(max_length=100)),
                (
                    "accommodation_type",
                    models.ForeignKey(
                        blank=True,
                        null=True,
                        on_delete=django.db.models.deletion.PROTECT,
                        related_name="rooms",
                        to="ipd_ward.accommodationtype",
                    ),
                ),
                (
                    "organization",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.PROTECT, to="tenancy.organization"
                    ),
                ),
                (
                    "ward",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.PROTECT,
                        related_name="rooms",
                        to="ipd_ward.ward",
                    ),
                ),
            ],
            options={
                "ordering": ["name"],
                "abstract": False,
                "base_manager_name": "all_objects",
            },
            managers=[
                ("objects", django.db.models.manager.Manager()),
                ("all_objects", django.db.models.manager.Manager()),
            ],
        ),
        migrations.AddField(
            model_name="bed",
            name="room",
            field=models.ForeignKey(
                blank=True,
                null=True,
                on_delete=django.db.models.deletion.PROTECT,
                related_name="beds",
                to="ipd_ward.room",
            ),
        ),
        migrations.AddConstraint(
            model_name="accommodationtype",
            constraint=models.UniqueConstraint(
                fields=("organization", "name"), name="unique_accommodation_type_per_org"
            ),
        ),
        migrations.AddConstraint(
            model_name="bedstay",
            constraint=models.UniqueConstraint(
                condition=models.Q(("ended_at__isnull", True)),
                fields=("admission",),
                name="one_open_bed_stay_per_admission",
            ),
        ),
        migrations.AddConstraint(
            model_name="bedstay",
            constraint=models.UniqueConstraint(
                condition=models.Q(("ended_at__isnull", True)),
                fields=("bed",),
                name="one_open_bed_stay_per_bed",
            ),
        ),
        migrations.AddConstraint(
            model_name="bednight",
            constraint=models.UniqueConstraint(
                fields=("admission", "night"), name="one_bed_night_per_admission_night"
            ),
        ),
        migrations.AddConstraint(
            model_name="room",
            constraint=models.UniqueConstraint(
                fields=("ward", "name"), name="unique_room_name_per_ward"
            ),
        ),
        migrations.RunSQL(RLS_FORWARD, reverse_sql=RLS_REVERSE),
        migrations.RunPython(forwards, backwards),
    ]
