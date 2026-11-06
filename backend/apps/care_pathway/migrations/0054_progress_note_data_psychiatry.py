from django.db import migrations, models


def add_psychiatry_note_type(apps, schema_editor):
    LocalValueSet = apps.get_model("care_pathway", "LocalValueSet")
    LocalConcept = apps.get_model("care_pathway", "LocalConcept")
    valueset, _ = LocalValueSet.objects.get_or_create(
        id="note-type", defaults={"title": "Progress note type"}
    )
    LocalConcept.objects.get_or_create(
        valueset=valueset,
        code="PSYCHIATRY",
        defaults={"display": "Psychiatric assessment", "order": 7},
    )


class Migration(migrations.Migration):
    dependencies = [("care_pathway", "0053_copy_soap_notes_to_progress_notes")]

    operations = [
        migrations.AddField(
            model_name="progressnote",
            name="data",
            field=models.JSONField(blank=True, default=dict),
        ),
        migrations.RunPython(add_psychiatry_note_type, migrations.RunPython.noop),
    ]
