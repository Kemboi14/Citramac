from django.db import migrations


def forwards(apps, schema_editor):
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
        ("care_pathway", "0029_labs_legal_forms_rls"),
    ]

    operations = [migrations.RunPython(forwards, migrations.RunPython.noop)]
