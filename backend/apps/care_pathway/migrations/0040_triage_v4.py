from django.db import migrations


def seed(apps, schema_editor):
    # Idempotent: adds the v4 triage value sets (triage_v4.VALUESETS). Existing
    # v3 triage value sets are left untouched so signed v3 answers still read.
    from apps.care_pathway.triage_v4 import VALUESETS

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
    dependencies = [("care_pathway", "0039_psychotherapy_note")]

    operations = [migrations.RunPython(seed, migrations.RunPython.noop)]
