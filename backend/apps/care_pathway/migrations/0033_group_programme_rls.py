from django.db import migrations

from apps.tenancy.rls import enable_rls_for_tables

FORWARD_SQL, REVERSE_SQL = enable_rls_for_tables(
    "care_pathway_groupprogrammecategory",
    "care_pathway_groupsession",
    "care_pathway_groupsessionentry",
)


class Migration(migrations.Migration):
    dependencies = [("care_pathway", "0032_group_programme")]

    operations = [migrations.RunSQL(FORWARD_SQL, reverse_sql=REVERSE_SQL)]
