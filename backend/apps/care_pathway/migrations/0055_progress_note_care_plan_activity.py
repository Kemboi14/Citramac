"""Care-plan notes: link a ProgressNote to the confirmed care-plan action and
add the served `CARE_PLAN` note type used when a clinician logs a note while
confirming a plan in the psychiatry module."""

import django.db.models.deletion
from django.db import migrations, models


def seed_note_type(apps, schema_editor):
    # Idempotent: the database owns the served list after this first seed.
    LocalValueSet = apps.get_model("care_pathway", "LocalValueSet")
    LocalConcept = apps.get_model("care_pathway", "LocalConcept")
    valueset, _ = LocalValueSet.objects.get_or_create(
        id="note-type", defaults={"title": "Progress note type"}
    )
    order = LocalConcept.objects.filter(valueset=valueset).count()
    LocalConcept.objects.get_or_create(
        valueset=valueset,
        code="CARE_PLAN",
        defaults={"display": "Care-plan note", "order": order},
    )


class Migration(migrations.Migration):
    dependencies = [("care_pathway", "0054_progress_note_data_psychiatry")]

    operations = [
        migrations.AddField(
            model_name="progressnote",
            name="care_plan_activity",
            field=models.ForeignKey(
                blank=True,
                null=True,
                on_delete=django.db.models.deletion.PROTECT,
                related_name="notes",
                to="care_pathway.careplanactivity",
            ),
        ),
        migrations.RunPython(seed_note_type, migrations.RunPython.noop),
    ]
