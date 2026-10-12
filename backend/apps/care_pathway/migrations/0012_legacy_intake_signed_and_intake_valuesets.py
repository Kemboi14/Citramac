from django.db import migrations
from django.db.models import F


def forwards(apps, schema_editor):
    # Every intake saved before sections existed was a one-shot save: it is a
    # signed record, authored by whoever saved it.
    Intake = apps.get_model("care_pathway", "IntakeAssessment")
    Intake.all_objects.filter(status="DRAFT", sections={}).update(
        status="SIGNED", completeness="COMPLETE", signed_at=F("created_at"), signed_by=F("author")
    )

    from apps.care_pathway.intake_schema import option_valuesets

    LocalValueSet = apps.get_model("care_pathway", "LocalValueSet")
    LocalConcept = apps.get_model("care_pathway", "LocalConcept")
    for valueset_id, (title, concepts) in option_valuesets().items():
        valueset, created = LocalValueSet.objects.get_or_create(
            id=valueset_id, defaults={"title": title}
        )
        if not created:
            continue
        for order, (code, display) in enumerate(concepts):
            LocalConcept.objects.create(valueset=valueset, code=code, display=display, order=order)


class Migration(migrations.Migration):
    dependencies = [
        ("care_pathway", "0011_medicationhistory_rls"),
    ]

    operations = [migrations.RunPython(forwards, migrations.RunPython.noop)]
