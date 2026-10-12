from django.db import migrations

from apps.tenancy.rls import enable_rls_for_tables

FORWARD_SQL, REVERSE_SQL = enable_rls_for_tables(
    "care_pathway_labresultacknowledgement",
    "care_pathway_legalform",
)


class Migration(migrations.Migration):
    dependencies = [("care_pathway", "0028_labs_legal_forms")]

    operations = [migrations.RunSQL(FORWARD_SQL, reverse_sql=REVERSE_SQL)]
