from django.db import migrations


def seed(apps, schema_editor):
    # Idempotent: adds the discharge and follow-up value sets introduced after 0005.
    from apps.care_pathway.valuesets import VALUESETS

    LocalValueSet = apps.get_model("care_pathway", "LocalValueSet")
    LocalConcept = apps.get_model("care_pathway", "LocalConcept")
    for valueset_id, (title, concepts) in VALUESETS.items():
        valueset, created = LocalValueSet.objects.get_or_create(
            id=valueset_id, defaults={"title": title}
        )
        if not created:
            continue
        for order, (code, display) in enumerate(concepts):
            LocalConcept.objects.create(valueset=valueset, code=code, display=display, order=order)


class Migration(migrations.Migration):
    dependencies = [("care_pathway", "0007_discharge_rls")]

    operations = [migrations.RunPython(seed, migrations.RunPython.noop)]
