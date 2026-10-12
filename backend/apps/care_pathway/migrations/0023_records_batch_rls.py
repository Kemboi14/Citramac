from django.db import migrations

from apps.tenancy.rls import enable_rls_for_tables

FORWARD_SQL, REVERSE_SQL = enable_rls_for_tables(
    "care_pathway_riskproposal",
    "care_pathway_capacityassessment",
    "care_pathway_visitconsent",
    "care_pathway_progressnote",
    "care_pathway_episodeoutcome",
)


class Migration(migrations.Migration):
    dependencies = [("care_pathway", "0022_records_batch")]

    operations = [migrations.RunSQL(FORWARD_SQL, reverse_sql=REVERSE_SQL)]
