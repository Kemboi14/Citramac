import uuid

import django.db.models.deletion
import django.db.models.manager
import django.utils.timezone
from django.conf import settings
from django.db import migrations, models

from apps.tenancy.rls import enable_rls_for_tables

FORWARD_SQL, REVERSE_SQL = enable_rls_for_tables("care_pathway_nursingcareplanentry")

# Value sets new in this pass, and concepts added to existing ones.
NEW_VALUESETS = (
    "care-plan-agreement",
    "care-plan-disagreement-part",
    "formulation-5p",
    "oat-offer",
    "episode-destination",
)
ADDED_CONCEPTS = {"follow-up-reason": ["CONTACT_72H"], "note-type": ["FOLLOW_UP"]}
# Agreement code from before v4, kept retired so stored plans still show their label.
RETIRED_AGREEMENT = ("DISAGREES", "Client disagrees")


def seed(apps, schema_editor):
    from apps.care_pathway.valuesets import VALUESETS

    LocalValueSet = apps.get_model("care_pathway", "LocalValueSet")
    LocalConcept = apps.get_model("care_pathway", "LocalConcept")
    for valueset_id in NEW_VALUESETS:
        title, concepts = VALUESETS[valueset_id]
        valueset, _ = LocalValueSet.objects.get_or_create(id=valueset_id, defaults={"title": title})
        for order, (code, display) in enumerate(concepts):
            LocalConcept.objects.get_or_create(
                valueset=valueset, code=code, defaults={"display": display, "order": order}
            )
    agreement = LocalValueSet.objects.get(id="care-plan-agreement")
    LocalConcept.objects.get_or_create(
        valueset=agreement, code=RETIRED_AGREEMENT[0],
        defaults={"display": RETIRED_AGREEMENT[1], "order": 99, "active": False},
    )
    for valueset_id, codes in ADDED_CONCEPTS.items():
        valueset = LocalValueSet.objects.filter(id=valueset_id).first()
        if valueset is None:
            continue
        displays = dict(VALUESETS[valueset_id][1])
        last = LocalConcept.objects.filter(valueset=valueset).count()
        for offset, code in enumerate(codes):
            LocalConcept.objects.get_or_create(
                valueset=valueset, code=code,
                defaults={"display": displays[code], "order": last + offset},
            )


class Migration(migrations.Migration):

    dependencies = [
        ("care_pathway", "0035_intake_v4"),
        ("client_registry", "0019_allergy_type_status_confirmation"),
        ("tenancy", "0015_theme_overrides_light_dark"),
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [
        migrations.AddField(
            model_name="careplan",
            name="advance_statement",
            field=models.TextField(blank=True),
        ),
        migrations.AddField(
            model_name="careplan",
            name="client_ack_at",
            field=models.DateTimeField(blank=True, null=True),
        ),
        migrations.AddField(
            model_name="careplan",
            name="client_ack_language",
            field=models.CharField(blank=True, max_length=2),
        ),
        migrations.AddField(
            model_name="careplan",
            name="client_ack_recorded_by",
            field=models.ForeignKey(
                blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL,
                related_name="+", to=settings.AUTH_USER_MODEL,
            ),
        ),
        migrations.AddField(
            model_name="careplan",
            name="crisis_plan",
            field=models.TextField(blank=True),
        ),
        migrations.AddField(
            model_name="careplan",
            name="discharge_readiness",
            field=models.JSONField(blank=True, default=dict),
        ),
        migrations.AddField(
            model_name="careplan",
            name="family_involvement",
            field=models.TextField(blank=True),
        ),
        migrations.AddField(
            model_name="careplan",
            name="goal_items",
            field=models.JSONField(blank=True, default=list),
        ),
        migrations.AddField(
            model_name="careplan",
            name="naloxone_teaching",
            field=models.BooleanField(default=False),
        ),
        migrations.AddField(
            model_name="careplan",
            name="oat_offer",
            field=models.CharField(blank=True, max_length=24),
        ),
        migrations.AddField(
            model_name="careplanactivity",
            name="bulk_accepted",
            field=models.BooleanField(default=False),
        ),
        migrations.AddField(
            model_name="mdtreview",
            name="dissent",
            field=models.TextField(blank=True),
        ),
        migrations.AddField(
            model_name="progressnote",
            name="appointment",
            field=models.ForeignKey(
                blank=True, null=True, on_delete=django.db.models.deletion.PROTECT,
                related_name="+", to="client_registry.appointment",
            ),
        ),
        migrations.AlterField(
            model_name="careplan",
            name="client_agreement",
            field=models.CharField(blank=True, max_length=10),
        ),
        migrations.CreateModel(
            name="NursingCarePlanEntry",
            fields=[
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("updated_at", models.DateTimeField(auto_now=True)),
                ("id", models.UUIDField(default=uuid.uuid4, editable=False, primary_key=True, serialize=False)),
                ("problem", models.CharField(max_length=300)),
                ("goal", models.CharField(max_length=300)),
                ("interventions", models.TextField(blank=True)),
                ("evaluations", models.JSONField(blank=True, default=list)),
                ("recorded_at", models.DateTimeField(default=django.utils.timezone.now)),
                ("activity", models.ForeignKey(
                    blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL,
                    related_name="+", to="care_pathway.careplanactivity",
                )),
                ("care_plan", models.ForeignKey(
                    on_delete=django.db.models.deletion.PROTECT, related_name="nursing_entries",
                    to="care_pathway.careplan",
                )),
                ("organization", models.ForeignKey(
                    on_delete=django.db.models.deletion.PROTECT, to="tenancy.organization",
                )),
                ("patient", models.ForeignKey(
                    on_delete=django.db.models.deletion.PROTECT, related_name="+",
                    to="client_registry.patient",
                )),
                ("recorded_by", models.ForeignKey(
                    blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL,
                    related_name="+", to=settings.AUTH_USER_MODEL,
                )),
            ],
            options={
                "ordering": ["recorded_at"],
                "abstract": False,
                "base_manager_name": "all_objects",
            },
            managers=[
                ("objects", django.db.models.manager.Manager()),
                ("all_objects", django.db.models.manager.Manager()),
            ],
        ),
        migrations.RunSQL(FORWARD_SQL, reverse_sql=REVERSE_SQL),
        migrations.RunPython(seed, migrations.RunPython.noop),
    ]
