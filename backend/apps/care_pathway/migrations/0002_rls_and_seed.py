from django.db import migrations

from apps.tenancy.rls import enable_rls_for_tables

TENANT_TABLES = [
    "care_pathway_episodeofcare",
    "care_pathway_episodestatushistory",
    "care_pathway_triageencounter",
    "care_pathway_triageassessment",
    "care_pathway_triagerecheck",
    "care_pathway_clinicalalert",
    "care_pathway_caretask",
    "care_pathway_intakeassessment",
    "care_pathway_outcomescore",
    "care_pathway_careplan",
    "care_pathway_careplanactivity",
    "care_pathway_billingservice",
    "care_pathway_interventionrecord",
    "care_pathway_chargeitem",
]

FORWARD_SQL, REVERSE_SQL = enable_rls_for_tables(*TENANT_TABLES)


def seed(apps, schema_editor):
    from apps.care_pathway.valuesets import BILLING_SERVICE_NAMES, VALUESETS

    LocalValueSet = apps.get_model("care_pathway", "LocalValueSet")
    LocalConcept = apps.get_model("care_pathway", "LocalConcept")
    for valueset_id, (title, concepts) in VALUESETS.items():
        valueset, _ = LocalValueSet.objects.update_or_create(
            id=valueset_id, defaults={"title": title}
        )
        for order, (code, display) in enumerate(concepts):
            LocalConcept.objects.update_or_create(
                valueset=valueset, code=code, defaults={"display": display, "order": order}
            )

    # Existing facilities get the service list unpriced (rates are configured,
    # never invented). Migrations run as the migration role, which bypasses
    # RLS, so the unscoped manager is safe here.
    Organization = apps.get_model("tenancy", "Organization")
    BillingService = apps.get_model("care_pathway", "BillingService")
    for organization_id in Organization.objects.values_list("id", flat=True):
        for name in BILLING_SERVICE_NAMES:
            BillingService.objects.get_or_create(organization_id=organization_id, name=name)


class Migration(migrations.Migration):
    dependencies = [
        ("care_pathway", "0001_initial"),
        ("tenancy", "0015_theme_overrides_light_dark"),
    ]

    operations = [
        migrations.RunSQL(FORWARD_SQL, reverse_sql=REVERSE_SQL),
        migrations.RunPython(seed, migrations.RunPython.noop),
    ]
