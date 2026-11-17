"""Family Psychotherapy becomes its own Interventions module (owner, 2026-11-17).

The care plan's "Family intervention" is delivered by Family Psychotherapy and
"Psychological therapy" by Individual Psychotherapy (the old Psychotherapy
module, renamed; its code is unchanged).

1. Every organisation gets a "Family Psychotherapy" tariff line with no rate.
   Rates are never invented: the Org Admin prices it, and until then family
   sessions are recorded with the visible "no rate" notice.
2. The served "intervention-module" value set (what the Interventions screen
   lists) gets the family_psychotherapy concept, and the psychotherapy
   concept is shown as "Individual Psychotherapy".
3. Past family-session deliveries move to the new module. Only the module
   label changes; the signed note, dates, provider, charge and signature are
   untouched.

Reverse: the deliveries move back, the value set is restored, and the tariff line is removed when it is
still unpriced and unused (a priced or used line is kept).
"""

from django.db import migrations

FAMILY = "Family therapy"
NAME = "Family Psychotherapy"
VALUESET_ID = "intervention-module"


def _bypass_rls(schema_editor):
    # Row-level security scopes each row to an organisation; a data migration
    # spans them all (the same pattern as accounts 0025).
    with schema_editor.connection.cursor() as cursor:
        cursor.execute("SELECT set_config('app.is_platform_admin', 'true', true)")


def forward(apps, schema_editor):
    _bypass_rls(schema_editor)
    Organization = apps.get_model("tenancy", "Organization")
    BillingService = apps.get_model("care_pathway", "BillingService")
    InterventionRecord = apps.get_model("care_pathway", "InterventionRecord")
    for organization_id in Organization.objects.values_list("id", flat=True):
        BillingService.objects.get_or_create(organization_id=organization_id, name=NAME)
    LocalConcept = apps.get_model("care_pathway", "LocalConcept")
    individual = LocalConcept.objects.filter(valueset_id=VALUESET_ID, code="psychotherapy").first()
    if individual is not None:
        individual.display = "Individual Psychotherapy"
        individual.save(update_fields=["display"])
        LocalConcept.objects.get_or_create(
            valueset_id=VALUESET_ID,
            code="family_psychotherapy",
            defaults={"display": NAME, "order": individual.order, "active": True},
        )
    InterventionRecord.objects.filter(module="psychotherapy", intervention=FAMILY).update(
        module="family_psychotherapy"
    )


def backward(apps, schema_editor):
    _bypass_rls(schema_editor)
    BillingService = apps.get_model("care_pathway", "BillingService")
    InterventionRecord = apps.get_model("care_pathway", "InterventionRecord")
    InterventionRecord.objects.filter(module="family_psychotherapy").update(module="psychotherapy")
    LocalConcept = apps.get_model("care_pathway", "LocalConcept")
    LocalConcept.objects.filter(valueset_id=VALUESET_ID, code="family_psychotherapy").delete()
    LocalConcept.objects.filter(valueset_id=VALUESET_ID, code="psychotherapy").update(
        display="Psychotherapy"
    )
    BillingService.objects.filter(name=NAME, rate__isnull=True).exclude(
        pk__in=InterventionRecord.objects.filter(billing_service__isnull=False).values(
            "billing_service"
        )
    ).delete()


class Migration(migrations.Migration):
    dependencies = [
        ("care_pathway", "0062_psychotherapy_questionnaire_version"),
    ]

    operations = [migrations.RunPython(forward, backward)]
