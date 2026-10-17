from django.db import migrations


def seed(apps, schema_editor):
    # Idempotent: adds the v4 Interventions module list as a served value set.
    from apps.care_pathway.intervention_catalogue import MODULES, VALUESET_ID, VALUESET_TITLE

    LocalValueSet = apps.get_model("care_pathway", "LocalValueSet")
    LocalConcept = apps.get_model("care_pathway", "LocalConcept")
    valueset, created = LocalValueSet.objects.get_or_create(
        id=VALUESET_ID, defaults={"title": VALUESET_TITLE}
    )
    if not created:
        return
    for order, module in enumerate(MODULES):
        LocalConcept.objects.create(
            valueset=valueset, code=module["code"], display=module["display"], order=order
        )


class Migration(migrations.Migration):
    dependencies = [("care_pathway", "0033_group_programme_rls")]

    operations = [migrations.RunPython(seed, migrations.RunPython.noop)]
