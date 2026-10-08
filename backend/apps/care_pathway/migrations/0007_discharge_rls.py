from django.db import migrations

from apps.tenancy.rls import enable_rls_for_tables

FORWARD_SQL, REVERSE_SQL = enable_rls_for_tables(
    "care_pathway_dischargesummary", "care_pathway_dischargemedicationline"
)


class Migration(migrations.Migration):
    dependencies = [("care_pathway", "0006_discharge_summary")]

    operations = [migrations.RunSQL(FORWARD_SQL, reverse_sql=REVERSE_SQL)]
