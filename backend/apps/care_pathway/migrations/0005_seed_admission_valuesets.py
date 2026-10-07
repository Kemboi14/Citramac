from django.db import migrations


def seed(apps, schema_editor):
    # Idempotent re-seed: adds value sets introduced after 0002 (admission
    # consent status, capacity assessed, next-of-kin notification, triage decision).
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
    dependencies = [("care_pathway", "0004_consenttemplate_rls")]

    operations = [migrations.RunPython(seed, migrations.RunPython.noop)]
