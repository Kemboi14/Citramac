from django.db import migrations


def seed(apps, schema_editor):
    # Idempotent: the order types for structured medication orders, served like
    # every other drop-down (CLAUDE.md §4 "Terminology is served").
    from apps.care_pathway.interventions import (
        ORDER_TYPE_VALUESET_ID,
        ORDER_TYPE_VALUESET_TITLE,
        ORDER_TYPES,
    )

    LocalValueSet = apps.get_model("care_pathway", "LocalValueSet")
    LocalConcept = apps.get_model("care_pathway", "LocalConcept")
    valueset, _ = LocalValueSet.objects.get_or_create(
        id=ORDER_TYPE_VALUESET_ID, defaults={"title": ORDER_TYPE_VALUESET_TITLE}
    )
    for order, (code, display) in enumerate(ORDER_TYPES):
        LocalConcept.objects.get_or_create(
            valueset=valueset, code=code, defaults={"display": display, "order": order}
        )


class Migration(migrations.Migration):
    dependencies = [("care_pathway", "0058_merge_caretask_and_care_programme")]

    operations = [migrations.RunPython(seed, migrations.RunPython.noop)]
