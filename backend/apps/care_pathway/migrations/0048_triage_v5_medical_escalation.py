"""Triage v5 rules 2026-10-28.2: the H next-step and vital-sign source value sets,
and the "Refer to another facility" action."""

from django.db import migrations


def seed(apps, schema_editor):
    # Idempotent; existing concepts are left as the database holds them.
    from apps.care_pathway.triage_v5 import VALUESETS as V5_VALUESETS

    LocalValueSet = apps.get_model("care_pathway", "LocalValueSet")
    LocalConcept = apps.get_model("care_pathway", "LocalConcept")
    for valueset_id in ("triage-medical-escalation", "triage-vitals-source"):
        title, concepts = V5_VALUESETS[valueset_id]
        valueset, _ = LocalValueSet.objects.get_or_create(id=valueset_id, defaults={"title": title})
        for order, (code, display) in enumerate(concepts):
            LocalConcept.objects.get_or_create(
                valueset=valueset, code=code, defaults={"display": display, "order": order}
            )
    actions = LocalValueSet.objects.filter(id="triage-action").first()
    if actions:
        order = LocalConcept.objects.filter(valueset=actions).count()
        LocalConcept.objects.get_or_create(
            valueset=actions,
            code="external_referral",
            defaults={"display": "Refer to another facility", "order": order},
        )


class Migration(migrations.Migration):
    dependencies = [("care_pathway", "0047_triage_v5_findings")]

    operations = [migrations.RunPython(seed, migrations.RunPython.noop)]
