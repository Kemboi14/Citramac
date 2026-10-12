from django.db import migrations

from apps.tenancy.rls import enable_rls_for_tables

FORWARD_SQL, REVERSE_SQL = enable_rls_for_tables(
    "care_pathway_observationlevelchange",
    "care_pathway_observerhandover",
    "care_pathway_observationentry",
    "care_pathway_restrictivepracticeepisode",
    "care_pathway_restrictivecheck",
)


class Migration(migrations.Migration):
    dependencies = [
        ("care_pathway", "0017_observationentry_observationlevelchange_and_more"),
    ]

    operations = [
        migrations.RunSQL(FORWARD_SQL, reverse_sql=REVERSE_SQL),
    ]
