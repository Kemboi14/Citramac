# Organisation-approved assessments (trauma, benzodiazepine withdrawal) + RLS;
# the psychiatric review outcome on CareTask, its served value set and triage
# action; the triage substance row "Sedatives" → "Benzodiazepines / sedatives"
# (rules 2026-10-29.1).

import uuid

import django.db.models.deletion
import django.db.models.manager
import django.utils.timezone
from django.conf import settings
from django.db import migrations, models

from apps.tenancy.rls import enable_rls_for_tables

RLS_FORWARD, RLS_REVERSE = enable_rls_for_tables("care_pathway_approvedassessment")


def seed(apps, schema_editor):
    # Idempotent; existing concepts are left as the database holds them, except
    # the one relabelled row.
    from apps.care_pathway.psychiatric_review import VALUESETS as REVIEW_VALUESETS

    LocalValueSet = apps.get_model("care_pathway", "LocalValueSet")
    LocalConcept = apps.get_model("care_pathway", "LocalConcept")
    for valueset_id, (title, concepts) in REVIEW_VALUESETS.items():
        valueset, _ = LocalValueSet.objects.get_or_create(id=valueset_id, defaults={"title": title})
        for order, (code, display) in enumerate(concepts):
            LocalConcept.objects.get_or_create(
                valueset=valueset, code=code, defaults={"display": display, "order": order}
            )
    actions = LocalValueSet.objects.filter(id="triage-action").first()
    if actions:
        LocalConcept.objects.get_or_create(
            valueset=actions,
            code="psychiatric_review_withdrawal",
            defaults={
                "display": "Psychiatric review — withdrawal",
                "order": LocalConcept.objects.filter(valueset=actions).count(),
            },
        )
    LocalConcept.objects.filter(
        valueset_id="triage-v4-substance", code="sedatives", display="Sedatives"
    ).update(display="Benzodiazepines / sedatives")


def unseed_label(apps, schema_editor):
    LocalConcept = apps.get_model("care_pathway", "LocalConcept")
    LocalConcept.objects.filter(
        valueset_id="triage-v4-substance",
        code="sedatives",
        display="Benzodiazepines / sedatives",
    ).update(display="Sedatives")


class Migration(migrations.Migration):

    dependencies = [
        ("care_pathway", "0048_triage_v5_medical_escalation"),
        ("tenancy", "0021_subscription_grace_period_days"),
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [
        migrations.AddField(
            model_name="caretask",
            name="outcome",
            field=models.CharField(blank=True, max_length=40),
        ),
        migrations.AddField(
            model_name="caretask",
            name="outcome_note",
            field=models.CharField(blank=True, max_length=500),
        ),
        migrations.CreateModel(
            name="ApprovedAssessment",
            fields=[
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("updated_at", models.DateTimeField(auto_now=True)),
                (
                    "id",
                    models.UUIDField(
                        default=uuid.uuid4, editable=False, primary_key=True, serialize=False
                    ),
                ),
                ("purpose", models.CharField(max_length=24)),
                ("instrument", models.CharField(blank=True, max_length=24)),
                ("clinical_lead", models.CharField(blank=True, max_length=150)),
                ("attestation", models.CharField(blank=True, max_length=500)),
                ("approved_at", models.DateTimeField(default=django.utils.timezone.now)),
                (
                    "approved_by",
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
            ],
            options={
                "ordering": ["-approved_at"],
                "abstract": False,
                "base_manager_name": "all_objects",
            },
            managers=[
                ("objects", django.db.models.manager.Manager()),
                ("all_objects", django.db.models.manager.Manager()),
            ],
        ),
        migrations.RunSQL(RLS_FORWARD, reverse_sql=RLS_REVERSE),
        migrations.RunPython(seed, unseed_label),
    ]
