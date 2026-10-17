from django.db import migrations


def seed(apps, schema_editor):
    # Idempotent: the route list for structured medication orders, served like
    # every other drop-down so a facility can revise it without a release.
    from apps.care_pathway.interventions import ROUTE_VALUESET_ID, ROUTE_VALUESET_TITLE, ROUTES

    LocalValueSet = apps.get_model("care_pathway", "LocalValueSet")
    LocalConcept = apps.get_model("care_pathway", "LocalConcept")
    valueset, created = LocalValueSet.objects.get_or_create(
        id=ROUTE_VALUESET_ID, defaults={"title": ROUTE_VALUESET_TITLE}
    )
    if not created:
        return
    for order, (code, display) in enumerate(ROUTES):
        LocalConcept.objects.create(valueset=valueset, code=code, display=display, order=order)


class Migration(migrations.Migration):
    """Intervention modules v4: the served medication-route value set."""

    dependencies = [("care_pathway", "0036_care_plan_v4")]

    operations = [migrations.RunPython(seed, migrations.RunPython.noop)]
