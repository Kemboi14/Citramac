# Triage v5 (the triage developer specification) and the shared clinical
# finding store: ClinicalFinding (+ RLS), the v5 / finding value sets, the
# PAWSS / CIWA-Ar / COWS triage actions and the v5 clinical alerts.

import uuid

import django.db.models.deletion
import django.db.models.manager
import django.utils.timezone
from django.conf import settings
from django.db import migrations, models

from apps.tenancy.rls import enable_rls_for_tables

RLS_FORWARD, RLS_REVERSE = enable_rls_for_tables("care_pathway_clinicalfinding")
ADDED_CONCEPTS = {
    "triage-action": ["pawss", "ciwa_ar", "cows"],
    "clinical-alert": ["MENTAL_STATE_CHANGE", "PSYCHOSIS_AGITATION", "MEDICAL_CONCERN"],
}


def seed(apps, schema_editor):
    # Idempotent; existing concepts are left as the database holds them.
    from apps.care_pathway.findings import VALUESETS as FINDING_VALUESETS
    from apps.care_pathway.triage_v5 import VALUESETS as V5_VALUESETS
    from apps.care_pathway.valuesets import VALUESETS

    LocalValueSet = apps.get_model("care_pathway", "LocalValueSet")
    LocalConcept = apps.get_model("care_pathway", "LocalConcept")
    for valueset_id, (title, concepts) in {**V5_VALUESETS, **FINDING_VALUESETS}.items():
        valueset, _ = LocalValueSet.objects.get_or_create(id=valueset_id, defaults={"title": title})
        for order, (code, display) in enumerate(concepts):
            LocalConcept.objects.get_or_create(
                valueset=valueset, code=code, defaults={"display": display, "order": order}
            )
    for valueset_id, codes in ADDED_CONCEPTS.items():
        valueset = LocalValueSet.objects.filter(id=valueset_id).first()
        if valueset is None:
            continue
        displays = dict(VALUESETS[valueset_id][1])
        last = LocalConcept.objects.filter(valueset=valueset).count()
        for offset, code in enumerate(codes):
            LocalConcept.objects.get_or_create(
                valueset=valueset,
                code=code,
                defaults={"display": displays[code], "order": last + offset},
            )


class Migration(migrations.Migration):

    dependencies = [
        ("care_pathway", "0046_alter_consenttemplate_consent_type"),
        ("client_registry", "0023_alter_consentrecord_consent_type"),
        ("clinical_encounter", "0007_prescription_item_prn_checks"),
        ("tenancy", "0021_subscription_grace_period_days"),
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [
        migrations.CreateModel(
            name="ClinicalFinding",
            fields=[
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("updated_at", models.DateTimeField(auto_now=True)),
                (
                    "id",
                    models.UUIDField(
                        default=uuid.uuid4, editable=False, primary_key=True, serialize=False
                    ),
                ),
                ("key", models.CharField(max_length=60)),
                ("domain", models.CharField(max_length=30)),
                ("title", models.CharField(max_length=120)),
                (
                    "status",
                    models.CharField(
                        choices=[
                            ("PRESENT", "Present"),
                            ("ABSENT", "Not present"),
                            ("UNKNOWN", "Unable to determine"),
                        ],
                        max_length=10,
                    ),
                ),
                ("summary", models.TextField(blank=True)),
                ("values", models.JSONField(blank=True, default=dict)),
                ("note", models.TextField(blank=True)),
                (
                    "action",
                    models.CharField(
                        choices=[
                            ("RECORDED", "Recorded"),
                            ("CONFIRMED", "Confirmed unchanged"),
                            ("UPDATED", "Updated"),
                        ],
                        default="RECORDED",
                        max_length=10,
                    ),
                ),
                ("stage", models.CharField(max_length=20)),
                ("source_code", models.CharField(max_length=30)),
                ("source_label", models.CharField(max_length=120)),
                ("source_detail", models.CharField(blank=True, max_length=200)),
                ("source_type", models.CharField(blank=True, max_length=40)),
                ("source_id", models.UUIDField(blank=True, null=True)),
                ("version", models.PositiveIntegerField(default=1)),
                ("recorded_at", models.DateTimeField(default=django.utils.timezone.now)),
                (
                    "encounter",
                    models.ForeignKey(
                        blank=True,
                        null=True,
                        on_delete=django.db.models.deletion.PROTECT,
                        related_name="+",
                        to="clinical_encounter.encounter",
                    ),
                ),
                (
                    "episode",
                    models.ForeignKey(
                        blank=True,
                        null=True,
                        on_delete=django.db.models.deletion.PROTECT,
                        related_name="+",
                        to="care_pathway.episodeofcare",
                    ),
                ),
                (
                    "organization",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.PROTECT, to="tenancy.organization"
                    ),
                ),
                (
                    "patient",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.PROTECT,
                        related_name="clinical_findings",
                        to="client_registry.patient",
                    ),
                ),
                (
                    "recorded_by",
                    models.ForeignKey(
                        blank=True,
                        null=True,
                        on_delete=django.db.models.deletion.SET_NULL,
                        related_name="+",
                        to=settings.AUTH_USER_MODEL,
                    ),
                ),
                (
                    "supersedes",
                    models.OneToOneField(
                        blank=True,
                        null=True,
                        on_delete=django.db.models.deletion.PROTECT,
                        related_name="superseded_by",
                        to="care_pathway.clinicalfinding",
                    ),
                ),
            ],
            options={
                "ordering": ["key", "-version"],
                "abstract": False,
                "base_manager_name": "all_objects",
                "constraints": [
                    models.UniqueConstraint(
                        fields=("patient", "key", "version"), name="uniq_clinical_finding_version"
                    )
                ],
            },
            managers=[
                ("objects", django.db.models.manager.Manager()),
                ("all_objects", django.db.models.manager.Manager()),
            ],
        ),
        migrations.RunSQL(RLS_FORWARD, reverse_sql=RLS_REVERSE),
        migrations.RunPython(seed, migrations.RunPython.noop),
    ]
