from django.db import migrations

from apps.tenancy.rls import enable_rls_for_tables

FORWARD_SQL, REVERSE_SQL = enable_rls_for_tables(
    "care_pathway_careplanversion",
    "care_pathway_careplantask",
    "care_pathway_safetyplan",
    "care_pathway_mdtreview",
    "care_pathway_cosignrequest",
)


class Migration(migrations.Migration):
    dependencies = [
        ("care_pathway", "0015_care_plan_decisions_safety_cosign"),
    ]

    operations = [
        migrations.RunSQL(FORWARD_SQL, reverse_sql=REVERSE_SQL),
    ]
