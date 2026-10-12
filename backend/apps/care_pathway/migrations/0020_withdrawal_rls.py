from django.db import migrations

from apps.tenancy.rls import enable_rls_for_tables

FORWARD_SQL, REVERSE_SQL = enable_rls_for_tables("care_pathway_assessmentattempt")


class Migration(migrations.Migration):
    dependencies = [("care_pathway", "0019_withdrawal_scales")]

    operations = [migrations.RunSQL(FORWARD_SQL, reverse_sql=REVERSE_SQL)]
